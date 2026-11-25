import { randomUUID } from 'node:crypto';
import { transaction } from './database.mjs';
import { animeCategory, animePlatform } from './categories.mjs';
import { storeRatings } from './ratings.mjs';
import { compactSubject, compactCharacter, keyStaff } from './compact.mjs';

export function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN');
}
const text = (value) => (typeof value === 'string' ? value : '');
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const day = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null);
export function normalizeSubject(raw) {
  if (!Number.isSafeInteger(raw.id) || raw.id < 1 || raw.type !== 2 || !text(raw.name))
    throw new Error('Expected an animation subject with a positive Bangumi ID and name');
  const aliases = (Array.isArray(raw.infobox) ? raw.infobox : [])
    .filter((i) => ['别名', '中文名'].includes(i.key))
    .flatMap((i) =>
      typeof i.value === 'string'
        ? [i.value]
        : Array.isArray(i.value)
          ? i.value.map((v) => v.v)
          : [],
    )
    .filter((v) => typeof v === 'string');
  const tags = [
    ...new Set(
      [
        ...(raw.tags || []).map((t) => (typeof t === 'string' ? t : t.name)),
        ...(raw.meta_tags || []),
      ].filter((v) => typeof v === 'string'),
    ),
  ];
  const ratingCount =
    finite(raw.rating?.total) ??
    (raw.score_details && typeof raw.score_details === 'object'
      ? Object.values(raw.score_details).reduce((sum, n) => sum + (finite(n) ?? 0), 0)
      : null);
  return {
    bangumiId: raw.id,
    name: raw.name,
    nameCn: text(raw.name_cn),
    summary: text(raw.summary),
    date: day(raw.date),
    platform: animePlatform(raw.platform),
    score: finite(raw.rating?.score ?? raw.score),
    ratingCount,
    rank: finite(raw.rating?.rank ?? raw.rank),
    nsfw: raw.nsfw ? 1 : 0,
    image: raw.images?.common || raw.images?.large || null,
    aliases,
    tags,
  };
}

export function upsertSubject(
  db,
  raw,
  {
    detailComplete = false,
    fetchedAt = new Date().toISOString(),
    tagSource = detailComplete ? 'api' : 'archive',
  } = {},
) {
  const s = normalizeSubject(raw);
  const old = db.prepare('SELECT id,rank FROM subjects WHERE bangumi_id=?').get(s.bangumiId);
  const id = old?.id || `subject_${randomUUID()}`;
  const normalizedTags = [...new Set(s.tags.map((tag) => normalize(tag).trim()).filter(Boolean))];
  if (old) {
    const other = db
      .prepare('SELECT tags FROM subject_tag_sets WHERE subject_id=? AND source<>?')
      .all(id, tagSource);
    s.tags = [...new Set([...normalizedTags, ...other.flatMap((row) => JSON.parse(row.tags))])];
  } else s.tags = normalizedTags;
  if (old && !Array.isArray(raw.infobox))
    s.aliases = db
      .prepare('SELECT name FROM subject_aliases WHERE subject_id=?')
      .all(id)
      .map((a) => a.name);
  const searchText = normalize([s.name, s.nameCn, ...s.aliases, ...s.tags].join(' '));
  db.prepare(
    `INSERT INTO subjects VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(bangumi_id) DO UPDATE SET
    name=excluded.name,name_cn=excluded.name_cn,summary=excluded.summary,air_date=excluded.air_date,
    platform=CASE WHEN excluded.platform='' THEN subjects.platform ELSE excluded.platform END,
    score=excluded.score,rating_count=COALESCE(excluded.rating_count,subjects.rating_count),rank=excluded.rank,
    nsfw=excluded.nsfw,image_url=COALESCE(excluded.image_url,subjects.image_url),search_text=excluded.search_text,updated_at=excluded.updated_at`,
  ).run(
    id,
    s.bangumiId,
    s.name,
    s.nameCn,
    s.summary,
    s.date,
    s.platform,
    s.score,
    s.ratingCount,
    s.rank,
    s.nsfw,
    s.image,
    searchText,
    fetchedAt,
  );
  db.prepare('DELETE FROM subject_aliases WHERE subject_id=?').run(id);
  db.prepare(
    'INSERT INTO subject_tag_sets VALUES(?,?,?,?) ON CONFLICT(subject_id,source) DO UPDATE SET tags=excluded.tags,fetched_at=excluded.fetched_at',
  ).run(id, tagSource, JSON.stringify(normalizedTags), fetchedAt);
  db.prepare('DELETE FROM subject_tags WHERE subject_id=?').run(id);
  for (const alias of new Set(s.aliases))
    db.prepare('INSERT INTO subject_aliases VALUES(?,?)').run(id, alias);
  for (const tag of new Set(s.tags.map(normalize).filter(Boolean)))
    db.prepare('INSERT INTO subject_tags VALUES(?,?)').run(id, tag);
  const rowid = db.prepare('SELECT rowid FROM subjects WHERE id=?').get(id).rowid;
  db.prepare('DELETE FROM subject_search WHERE rowid=?').run(rowid);
  db.prepare('INSERT INTO subject_search(rowid,subject_id,text) VALUES(?,?,?)').run(
    rowid,
    id,
    searchText,
  );
  // Archive snapshots never replace a fully hydrated detail cache.
  if (
    detailComplete ||
    !db.prepare('SELECT detail_complete FROM source_records WHERE subject_id=?').get(id)
      ?.detail_complete
  ) {
    db.prepare(
      `INSERT INTO source_records VALUES(?,'bangumi',?,?,?) ON CONFLICT(subject_id) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at,detail_complete=excluded.detail_complete`,
    ).run(id, JSON.stringify(compactSubject(raw)), fetchedAt, detailComplete ? 1 : 0);
  }
  const ratingsAccepted = storeRatings(
    db,
    id,
    raw,
    fetchedAt,
    tagSource === 'archive' ? 'archive' : 'api',
  );
  const savedRating = db.prepare('SELECT * FROM subject_ratings WHERE subject_id=?').get(id);
  if (savedRating)
    db.prepare('UPDATE subjects SET score=?,rating_count=? WHERE id=?').run(
      savedRating.total ? Math.round((savedRating.sum / savedRating.total) * 10) / 10 : 0,
      savedRating.total,
      id,
    );
  if (!ratingsAccepted && savedRating?.source === 'api' && old)
    db.prepare('UPDATE subjects SET rank=? WHERE id=?').run(old.rank, id);
  return id;
}

export function storeBundle(db, bundle) {
  return transaction(db, () => {
    const id = upsertSubject(db, bundle.subject, { detailComplete: true });
    const fetchedAt = db
      .prepare('SELECT fetched_at FROM source_records WHERE subject_id=?')
      .get(id).fetched_at;
    db.prepare(
      'INSERT INTO subject_metadata_sync VALUES(?,?,?,NULL,?) ON CONFLICT(subject_id) DO UPDATE SET fetched_at=excluded.fetched_at,last_attempt_at=excluded.last_attempt_at,last_error=NULL,payload=excluded.payload',
    ).run(id, fetchedAt, fetchedAt, null);
    for (const ep of bundle.episodes) {
      db.prepare(
        `INSERT INTO episodes VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(bangumi_id) DO UPDATE SET sort=excluded.sort,type=excluded.type,name=excluded.name,name_cn=excluded.name_cn,air_date=excluded.air_date,payload=excluded.payload`,
      ).run(
        `bgm-episode-${ep.id}`,
        id,
        ep.id,
        ep.sort,
        ep.type,
        text(ep.name),
        text(ep.name_cn),
        day(ep.airdate),
        '{}',
      );
    }
    db.prepare('DELETE FROM subject_characters WHERE subject_id=?').run(id);
    db.prepare('DELETE FROM subject_staff WHERE subject_id=?').run(id);
    db.prepare('DELETE FROM character_voices WHERE subject_id=?').run(id);
    const putPerson = (p) => {
      const pid = `bgm-person-${p.id}`;
      db.prepare(
        'INSERT INTO persons VALUES(?,?,?,?) ON CONFLICT(bangumi_id) DO UPDATE SET name=excluded.name,payload=excluded.payload',
      ).run(pid, p.id, p.name, '{}');
      return pid;
    };
    for (const c of bundle.characters) {
      const cid = `bgm-character-${c.id}`;
      db.prepare(
        'INSERT INTO characters VALUES(?,?,?,?) ON CONFLICT(bangumi_id) DO UPDATE SET name=excluded.name,payload=excluded.payload',
      ).run(cid, c.id, c.name, JSON.stringify(compactCharacter(c)));
      db.prepare('INSERT OR IGNORE INTO subject_characters VALUES(?,?,?)').run(
        id,
        cid,
        c.relation || '',
      );
      for (const actor of c.actors || [])
        db.prepare('INSERT OR IGNORE INTO character_voices VALUES(?,?,?)').run(
          id,
          cid,
          putPerson(actor),
        );
    }
    for (const p of bundle.persons.filter((p) => keyStaff.has(p.relation)))
      db.prepare('INSERT OR IGNORE INTO subject_staff VALUES(?,?,?)').run(
        id,
        putPerson(p),
        p.relation || '',
      );
    return id;
  });
}

export function rebuildSubjectIndex(db, id) {
  const subject = db.prepare('SELECT rowid,name,name_cn FROM subjects WHERE id=?').get(id);
  if (!subject) throw new Error('Unknown subject');
  const tags = [
    ...new Set(
      db
        .prepare('SELECT tags FROM subject_tag_sets WHERE subject_id=?')
        .all(id)
        .flatMap((row) => JSON.parse(row.tags))
        .map((value) => normalize(value).trim())
        .filter(Boolean),
    ),
  ];
  db.prepare('DELETE FROM subject_tags WHERE subject_id=?').run(id);
  const insert = db.prepare('INSERT INTO subject_tags VALUES(?,?)');
  for (const tag of tags) insert.run(id, tag);
  const aliases = db
    .prepare('SELECT name FROM subject_aliases WHERE subject_id=?')
    .all(id)
    .map((row) => row.name);
  const value = normalize([subject.name, subject.name_cn, ...aliases, ...tags].join(' '));
  db.prepare('UPDATE subjects SET search_text=? WHERE id=?').run(value, id);
  db.prepare('DELETE FROM subject_search WHERE rowid=?').run(subject.rowid);
  db.prepare('INSERT INTO subject_search(rowid,subject_id,text) VALUES(?,?,?)').run(
    subject.rowid,
    id,
    value,
  );
}

export function storeTagSnapshot(db, id, source, tags, fetchedAt = new Date().toISOString()) {
  const values = [...new Set(tags.map((value) => normalize(value).trim()).filter(Boolean))];
  db.prepare(
    'INSERT INTO subject_tag_sets VALUES(?,?,?,?) ON CONFLICT(subject_id,source) DO UPDATE SET tags=excluded.tags,fetched_at=excluded.fetched_at',
  ).run(id, source, JSON.stringify(values), fetchedAt);
  rebuildSubjectIndex(db, id);
}

export class InputError extends Error {
  status = 400;
}
export function searchCatalog(db, params) {
  const q = normalize(params.get('q') || '').trim();
  if (q.length > 100) throw new InputError('搜索词最多 100 字');
  const number = (key, min, max, fallback) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    if (!raw.trim() || !Number.isFinite(n) || n < min || n > max)
      throw new InputError(`无效参数：${key}`);
    return n;
  };
  const year = number('year', 1900, 2200, null),
    quarter = number('quarter', 1, 4, null),
    minScore = number('minScore', 0, 10, null),
    maxScore = number('maxScore', 0, 10, null),
    minVotes = number('minVotes', 0, 1e9, 100);
  const page = number('page', 1, 100000, 1),
    limit = number('limit', 1, 100, 20);
  if ([year, quarter, page, limit, minVotes].some((n) => n !== null && !Number.isInteger(n)))
    throw new InputError('年份、季度、页码、数量必须为整数');
  if (quarter && !year) throw new InputError('季度筛选需要同时提供年份');
  const category = params.has('category') ? animeCategory(params.get('category')) : null;
  if (params.has('category') && !category) throw new InputError('无效动画细分类');
  for (const key of ['minScore', 'maxScore']) {
    if (params.has(key) && !/^\d{1,2}(?:\.\d)?$/.test(params.get(key).trim()))
      throw new InputError('评分须为0至10的整数或一位小数');
  }
  if (minScore !== null && maxScore !== null && minScore > maxScore)
    throw new InputError('最低评分不能大于最高评分');
  const tags = params
    .getAll('tag')
    .map((value) => normalize(value).trim())
    .filter(Boolean);
  if (tags.length > 10 || tags.some((t) => t.length > 50))
    throw new InputError('标签最多 10 个，每个最多 50 字');
  const clauses = ['s.nsfw=0'],
    args = [];
  if (category) {
    clauses.push('s.platform=?');
    args.push(category.name);
  }
  if (q) {
    if ([...q].length >= 3) {
      clauses.push('s.id IN (SELECT subject_id FROM subject_search WHERE text MATCH ?)');
      args.push(`"${q.replaceAll('"', '""')}"`);
    } else {
      clauses.push("s.search_text LIKE ? ESCAPE '\\'");
      args.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    }
  }
  if (year) {
    const start = quarter ? (quarter - 1) * 3 + 1 : 1;
    const end = quarter ? start + 3 : 13;
    clauses.push('s.air_date>=? AND s.air_date<?');
    args.push(
      `${year}-${String(start).padStart(2, '0')}-01`,
      end === 13 ? `${year + 1}-01-01` : `${year}-${String(end).padStart(2, '0')}-01`,
    );
  }
  if (minScore !== null) {
    clauses.push('s.score>=?');
    args.push(minScore);
  }
  if (maxScore !== null) {
    clauses.push('s.score<=?');
    args.push(maxScore);
  }
  if (minVotes !== null) {
    clauses.push('s.rating_count>=?');
    args.push(minVotes);
  }
  for (const tag of tags) {
    const synced = db.prepare('SELECT fetched_at FROM tag_query_sync WHERE tag=?').get(tag);
    if (synced?.fetched_at) {
      clauses.push(
        'EXISTS (SELECT 1 FROM subject_tag_sets t WHERE t.subject_id=s.id AND t.source=?)',
      );
      args.push(`search:${tag}`);
    } else {
      clauses.push('EXISTS (SELECT 1 FROM subject_tags t WHERE t.subject_id=s.id AND t.tag=?)');
      args.push(tag);
    }
  }
  const sorts = {
    date: 's.air_date DESC,s.bangumi_id DESC',
    score:
      'COALESCE((SELECT 1.0*r.sum/NULLIF(r.total,0) FROM subject_ratings r WHERE r.subject_id=s.id),s.score) DESC,s.rating_count DESC,s.bangumi_id',
    votes: 's.rating_count DESC,s.bangumi_id',
    name: 's.name_cn,s.name,s.bangumi_id',
  };
  const sort = params.get('sort') || 'score';
  if (!sorts[sort]) throw new InputError('无效排序方式');
  const where = clauses.join(' AND ');
  const total = db
    .prepare(`SELECT count(*) AS total FROM subjects s WHERE ${where}`)
    .get(...args).total;
  const items = db
    .prepare(`SELECT s.* FROM subjects s WHERE ${where} ORDER BY ${sorts[sort]} LIMIT ? OFFSET ?`)
    .all(...args, limit, (page - 1) * limit)
    .map((s) => serialize(db, s));
  return { items, total, page, limit, scope: 'local-catalog', query: q };
}
export function serialize(db, s) {
  const { search_text, ...subject } = s;
  const rating = db.prepare('SELECT * FROM subject_ratings WHERE subject_id=?').get(s.id);
  return {
    ...subject,
    rating_distribution: rating
      ? Object.fromEntries(JSON.parse(rating.counts).map((n, i) => [i + 1, n]))
      : null,
    score_exact: rating?.total ? rating.sum / rating.total : null,
    rating_updated_at: rating?.fetched_at ?? null,
    category: animeCategory(s.platform),
    tags: db
      .prepare('SELECT tag FROM subject_tags WHERE subject_id=? ORDER BY tag')
      .all(s.id)
      .map((t) => t.tag),
    aliases: db
      .prepare('SELECT name FROM subject_aliases WHERE subject_id=?')
      .all(s.id)
      .map((t) => t.name),
  };
}
export function getSubject(db, id) {
  const s = db.prepare('SELECT * FROM subjects WHERE id=?').get(id);
  if (!s) return null;
  if (s.nsfw) return { id: s.id, bangumi_id: s.bangumi_id, restricted: true };
  const cache = db
    .prepare('SELECT fetched_at,detail_complete,payload FROM source_records WHERE subject_id=?')
    .get(id);
  return {
    ...serialize(db, s),
    source: {
      name: 'bangumi',
      url: `https://bgm.tv/subject/${s.bangumi_id}`,
      fetchedAt: cache?.fetched_at,
      detailComplete: !!cache?.detail_complete,
    },
    infobox: cache?.detail_complete ? JSON.parse(cache.payload).infobox || [] : [],
    episodes: db
      .prepare('SELECT * FROM episodes WHERE subject_id=? ORDER BY type,sort,bangumi_id')
      .all(id)
      .map((e) => ({ ...e, payload: JSON.parse(e.payload) })),
    characters: db
      .prepare(
        'SELECT c.*,sc.relation FROM characters c JOIN subject_characters sc ON sc.character_id=c.id WHERE sc.subject_id=?',
      )
      .all(id)
      .map((c) => ({
        ...c,
        payload: JSON.parse(c.payload),
        actors: db
          .prepare(
            'SELECT p.id,p.name FROM persons p JOIN character_voices v ON v.person_id=p.id WHERE v.subject_id=? AND v.character_id=?',
          )
          .all(id, c.id),
      })),
    persons: db
      .prepare(
        'SELECT p.*,s.relation FROM persons p JOIN subject_staff s ON s.person_id=p.id WHERE s.subject_id=?',
      )
      .all(id)
      .map((p) => ({ ...p, payload: JSON.parse(p.payload) })),
  };
}
