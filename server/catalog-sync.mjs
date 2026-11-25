import { transaction } from './database.mjs';
import { animePlatform } from './categories.mjs';
import {
  normalize,
  normalizeSubject,
  upsertSubject,
  storeTagSnapshot,
  rebuildSubjectIndex,
} from './catalog.mjs';

export function repairCatalog(db) {
  return transaction(db, () => {
    const rows = db
      .prepare(
        'SELECT s.id,s.platform,r.payload,r.fetched_at,r.detail_complete,m.payload metadata_payload,m.fetched_at metadata_at FROM subjects s LEFT JOIN source_records r ON r.subject_id=s.id LEFT JOIN subject_metadata_sync m ON m.subject_id=s.id',
      )
      .all();
    let categories = 0,
      restoredTagSources = 0;
    for (const row of rows) {
      if (!row.payload) continue;
      const raw = JSON.parse(row.payload);
      const preferred =
        row.metadata_payload && (!row.detail_complete || row.metadata_at > row.fetched_at)
          ? JSON.parse(row.metadata_payload)
          : raw;
      const platform = animePlatform(preferred.platform);
      if (platform && row.platform !== platform) {
        db.prepare('UPDATE subjects SET platform=? WHERE id=?').run(platform, row.id);
        categories++;
      }
      // Recover richer cached tags even if an older archive import overwrote the index.
      if (row.metadata_payload) continue;
      const tags = normalizeSubject(raw).tags;
      const source = row.detail_complete ? 'api' : 'archive';
      const present = db
        .prepare('SELECT tags FROM subject_tag_sets WHERE subject_id=? AND source=?')
        .get(row.id, source);
      const encoded = JSON.stringify([
        ...new Set(tags.map((value) => normalize(value).trim()).filter(Boolean)),
      ]);
      if (!present || present.tags !== encoded) {
        storeTagSnapshot(db, row.id, source, tags, row.fetched_at);
        restoredTagSources++;
      }
      if (row.detail_complete)
        db.prepare('INSERT OR IGNORE INTO subject_metadata_sync VALUES(?,?,?,NULL,?)').run(
          row.id,
          row.fetched_at,
          row.fetched_at,
          null,
        );
    }
    return {
      subjects: rows.length,
      categories,
      restoredTagSources,
      unknownCategories: db.prepare("SELECT count(*) n FROM subjects WHERE platform=''").get().n,
    };
  });
}

export function storeMetadata(db, raw, fetchedAt = new Date().toISOString()) {
  if (raw.type !== 2 || raw.nsfw) throw new Error('Only non-R18 animation metadata is supported');
  return transaction(db, () => {
    const id = upsertSubject(db, raw, { tagSource: 'api', fetchedAt });
    db.prepare(
      'INSERT INTO subject_metadata_sync VALUES(?,?,?,NULL,?) ON CONFLICT(subject_id) DO UPDATE SET fetched_at=excluded.fetched_at,last_attempt_at=excluded.last_attempt_at,last_error=NULL,payload=excluded.payload',
    ).run(id, fetchedAt, fetchedAt, null);
    return id;
  });
}

export async function syncMetadata(
  db,
  client,
  { limit = 50, ids, force = false, onProgress = () => {} } = {},
) {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const candidates = ids
    ? ids
        .map((id) =>
          db.prepare('SELECT id,bangumi_id FROM subjects WHERE bangumi_id=? AND nsfw=0').get(id),
        )
        .filter(Boolean)
    : db
        .prepare(
          `SELECT s.id,s.bangumi_id FROM subjects s LEFT JOIN subject_metadata_sync m ON m.subject_id=s.id WHERE s.nsfw=0 ${force ? '' : 'AND (m.fetched_at IS NULL OR m.fetched_at<?)'} ORDER BY COALESCE(s.rating_count,0) DESC,s.bangumi_id LIMIT ?`,
        )
        .all(...(force ? [] : [cutoff]), limit);
  let succeeded = 0,
    failed = 0;
  for (const row of candidates) {
    try {
      storeMetadata(db, await client.request(`/v0/subjects/${row.bangumi_id}`));
      succeeded++;
    } catch (error) {
      failed++;
      db.prepare(
        'INSERT INTO subject_metadata_sync(subject_id,last_attempt_at,last_error) VALUES(?,?,?) ON CONFLICT(subject_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_error=excluded.last_error',
      ).run(row.id, new Date().toISOString(), error.message);
      onProgress({ id: row.bangumi_id, error: error.message, succeeded, failed });
      if ([401, 403, 429].includes(error.upstreamStatus)) break;
      continue;
    }
    onProgress({ id: row.bangumi_id, succeeded, failed });
  }
  return { selected: candidates.length, succeeded, failed };
}

export async function syncTag(
  db,
  client,
  input,
  { maxPages = 5000, onProgress = () => {}, isCancelled = () => false } = {},
) {
  const tag = normalize(input).trim();
  if (!tag || tag.length > 50) throw new Error('Tag must contain 1–50 characters');
  const found = new Map();
  let offset = 0,
    total;
  for (let page = 0; page < maxPages; page++) {
    const result = await client.searchTag(tag, offset);
    if (isCancelled()) throw new Error('Tag sync cancelled');
    if (
      !Array.isArray(result.data) ||
      !Number.isSafeInteger(result.total) ||
      result.total < 0 ||
      result.data.some(
        (row) => !Number.isSafeInteger(row.id) || row.id < 1 || row.type !== 2 || row.nsfw,
      )
    )
      throw new Error('Unexpected upstream tag result');
    total = result.total;
    for (const row of result.data) found.set(row.id, row);
    offset += result.data.length;
    onProgress({ tag, received: found.size, total });
    if (offset >= total) break;
    if (!result.data.length || page + 1 === maxPages)
      throw new Error('Tag pagination incomplete; existing index preserved');
  }
  if (total === undefined || found.size !== total)
    throw new Error('Tag results changed during pagination; retry before replacing index');
  // Existing metadata is never overwritten by the search API's abbreviated rows.
  const missing = new Map();
  for (const id of found.keys())
    if (!db.prepare('SELECT id FROM subjects WHERE bangumi_id=?').get(id)) {
      const raw = await client.request(`/v0/subjects/${id}`);
      if (isCancelled()) throw new Error('Tag sync cancelled');
      if (raw.id !== id || raw.type !== 2 || raw.nsfw)
        throw new Error('Unexpected subject metadata');
      missing.set(id, raw);
    }
  if (isCancelled()) throw new Error('Tag sync cancelled');
  return transaction(db, () => {
    const source = `search:${tag}`,
      fetchedAt = new Date().toISOString();
    const affected = new Set(
      db
        .prepare('SELECT subject_id FROM subject_tag_sets WHERE source=?')
        .all(source)
        .map((row) => row.subject_id),
    );
    db.prepare('DELETE FROM subject_tag_sets WHERE source=?').run(source);
    for (const [bgmId] of found) {
      const existing = db.prepare('SELECT id FROM subjects WHERE bangumi_id=?').get(bgmId);
      const id =
        existing?.id || upsertSubject(db, missing.get(bgmId), { tagSource: 'api', fetchedAt });
      db.prepare('INSERT INTO subject_tag_sets VALUES(?,?,?,?)').run(
        id,
        source,
        JSON.stringify([tag]),
        fetchedAt,
      );
      affected.add(id);
    }
    for (const id of affected) rebuildSubjectIndex(db, id);
    db.prepare(
      'INSERT INTO tag_query_sync VALUES(?,?,?,NULL,?) ON CONFLICT(tag) DO UPDATE SET fetched_at=excluded.fetched_at,last_attempt_at=excluded.last_attempt_at,last_error=NULL,matched=excluded.matched',
    ).run(tag, fetchedAt, fetchedAt, found.size);
    return { tag, matched: found.size, newSubjects: missing.size, source, fetchedAt };
  });
}
