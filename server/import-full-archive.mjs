import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { openDatabase, transaction } from './database.mjs';
import { normalize, normalizeSubject, rebuildSubjectIndex, upsertSubject } from './catalog.mjs';

const datasets = [
  'subject',
  'episode',
  'subject-relations',
  'subject-persons',
  'subject-characters',
  'person-characters',
  'person',
  'character',
  'person-relations',
];
const execFileAsync = promisify(execFile);

// Bangumi's animation staff IDs (bangumi/common, subject_staffs.yml).
const staffRoles = {
  1: '原作',
  2: '导演',
  3: '脚本',
  6: '音乐',
  8: '人物设定',
  10: '系列构成',
  63: '制作',
  67: '动画制作',
  74: '总导演',
};
const characterRoles = { 1: '主角', 2: '配角', 3: '客串' };

function parseInfobox(wiki) {
  if (Array.isArray(wiki)) return wiki;
  if (typeof wiki !== 'string') return [];
  const fields = [];
  for (const match of wiki.matchAll(
    /^\s*\|([^=\r\n]+)=\s*([\s\S]*?)(?=^\s*\||^\s*}}\s*$|$(?![\s\S]))/gm,
  )) {
    const raw = match[2].trim();
    const value = raw.startsWith('{')
      ? [...raw.matchAll(/\[([^\]\r\n]+)\]/g)]
          .map(([, entry]) => {
            const separator = entry.indexOf('|');
            return separator < 0
              ? { v: entry.trim() }
              : { k: entry.slice(0, separator).trim(), v: entry.slice(separator + 1).trim() };
          })
          .filter((item) => item.v)
      : raw;
    if (value.length) fields.push({ key: match[1].trim(), value });
  }
  return fields;
}

async function readEntry(zip, entry, consume) {
  const child = spawn('tar', ['-xOf', zip, entry], {
    stdio: ['ignore', 'pipe', 'inherit'],
    windowsHide: true,
  });
  const done = once(child, 'close');
  // Surface spawn failures even if the stream closes before it yields a row.
  void done.catch(() => {});
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line.trim()) consume(JSON.parse(line), line);
    const [code] = await done;
    if (code !== 0) throw new Error('Unable to read ' + entry + ' (tar exited ' + code + ')');
  } finally {
    lines.close();
    if (child.exitCode === null) child.kill();
  }
}

async function importArchive(db, zip, entries, run) {
  const workIds = new Map(
    db
      .prepare('SELECT bangumi_id,id FROM subjects')
      .all()
      .map((s) => [s.bangumi_id, s.id]),
  );
  const archivedWorks = new Set();
  const people = new Set();
  const characters = new Set();
  const putRaw = db.prepare(
    'INSERT INTO archive_records VALUES(?,?,?) ON CONFLICT(dataset,record_key) DO UPDATE SET payload=excluded.payload WHERE payload<>excluded.payload',
  );
  const putInfo = db.prepare(
    'INSERT INTO archive_infoboxes VALUES(?,?) ON CONFLICT(subject_id) DO UPDATE SET fields=excluded.fields WHERE fields<>excluded.fields',
  );
  const putAlias = db.prepare('INSERT OR IGNORE INTO subject_aliases VALUES(?,?)');
  const getPreviousSubject = db.prepare(
    "SELECT payload FROM archive_records WHERE dataset='subject' AND record_key=?",
  );
  const hasLiveSubject = db.prepare(
    'SELECT EXISTS(SELECT 1 FROM source_records WHERE subject_id=? AND detail_complete=1) OR EXISTS(SELECT 1 FROM subject_metadata_sync WHERE subject_id=? AND fetched_at IS NOT NULL) AS live',
  );
  const getArchiveTags = db.prepare(
    "SELECT tags FROM subject_tag_sets WHERE subject_id=? AND source='archive'",
  );
  const putArchiveTags = db.prepare(
    "INSERT INTO subject_tag_sets VALUES(?,'archive',?,?) ON CONFLICT(subject_id,source) DO UPDATE SET tags=excluded.tags,fetched_at=excluded.fetched_at",
  );
  const putEpisode = db.prepare(
    'INSERT INTO episodes VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(bangumi_id) DO NOTHING',
  );
  const putPerson = db.prepare(
    'INSERT INTO persons VALUES(?,?,?,?) ON CONFLICT(bangumi_id) DO NOTHING',
  );
  const putCharacter = db.prepare(
    'INSERT INTO characters VALUES(?,?,?,?) ON CONFLICT(bangumi_id) DO NOTHING',
  );
  const putCast = db.prepare('INSERT OR IGNORE INTO subject_characters VALUES(?,?,?)');
  const putVoice = db.prepare('INSERT OR IGNORE INTO character_voices VALUES(?,?,?)');
  const putStaff = db.prepare('INSERT OR IGNORE INTO subject_staff VALUES(?,?,?)');
  const findPerson = db.prepare('SELECT id FROM persons WHERE bangumi_id=?');
  const findCharacter = db.prepare('SELECT id FROM characters WHERE bangumi_id=?');
  const readRelations = db.prepare('SELECT payload FROM archive_records WHERE dataset=?');
  const progress = db.prepare('UPDATE import_runs SET processed=? WHERE id=?');
  const stamp = new Date().toISOString();
  let processed = 0;
  const accept = {
    subject(row, raw) {
      if (row.type !== 2) return;
      const infobox = parseInfobox(row.infobox);
      const subject = { ...row, infobox };
      let id = workIds.get(row.id);
      if (!id) {
        id = upsertSubject(db, subject, { fetchedAt: stamp });
        workIds.set(row.id, id);
      } else if (
        getPreviousSubject.get(String(row.id))?.payload !== raw &&
        !hasLiveSubject.get(id, id).live
      ) {
        upsertSubject(db, subject, { fetchedAt: stamp });
      } else {
        const normalized = normalizeSubject(subject);
        const tags = JSON.stringify([
          ...new Set(normalized.tags.map((tag) => normalize(tag).trim()).filter(Boolean)),
        ]);
        let changed = getArchiveTags.get(id)?.tags !== tags;
        if (changed) putArchiveTags.run(id, tags, stamp);
        for (const alias of normalized.aliases) {
          if (putAlias.run(id, alias).changes) changed = true;
        }
        if (changed) rebuildSubjectIndex(db, id);
      }
      putInfo.run(id, JSON.stringify(infobox));
      archivedWorks.add(row.id);
      return row.id;
    },
    episode(row) {
      if (!archivedWorks.has(row.subject_id)) return;
      if (Number.isFinite(row.sort) && Number.isInteger(row.type)) {
        putEpisode.run(
          'bgm-episode-' + row.id,
          workIds.get(row.subject_id),
          row.id,
          row.sort,
          row.type,
          row.name || '',
          row.name_cn || '',
          /^\d{4}-\d{2}-\d{2}$/.test(row.airdate) ? row.airdate : null,
          JSON.stringify({ description: row.description, duration: row.duration, disc: row.disc }),
        );
      }
      return row.id;
    },
    'subject-relations'(row) {
      if (archivedWorks.has(row.subject_id))
        return [row.subject_id, row.related_subject_id, row.relation_type, row.order].join(':');
    },
    'subject-persons'(row) {
      if (!archivedWorks.has(row.subject_id)) return;
      people.add(row.person_id);
      return [row.subject_id, row.person_id, row.position].join(':');
    },
    'subject-characters'(row) {
      if (!archivedWorks.has(row.subject_id)) return;
      characters.add(row.character_id);
      return [row.subject_id, row.character_id].join(':');
    },
    'person-characters'(row) {
      if (!archivedWorks.has(row.subject_id)) return;
      people.add(row.person_id);
      characters.add(row.character_id);
      return [row.subject_id, row.character_id, row.person_id, row.type].join(':');
    },
    person(row) {
      if (!people.has(row.id)) return;
      putPerson.run('bgm-person-' + row.id, row.id, row.name, '{}');
      return row.id;
    },
    character(row) {
      if (!characters.has(row.id)) return;
      putCharacter.run('bgm-character-' + row.id, row.id, row.name, '{}');
      return row.id;
    },
    'person-relations'(row) {
      const ids = row.person_type === 'prsn' ? people : characters;
      if (ids.has(row.person_id) || ids.has(row.related_person_id))
        return [row.person_type, row.person_id, row.related_person_id, row.relation_type].join(':');
    },
  };
  for (const dataset of datasets) {
    let count = 0;
    let batch = [];
    const flush = () => {
      transaction(db, () => {
        for (const [row, raw] of batch) {
          const key = accept[dataset](row, raw);
          if (key === undefined) continue;
          putRaw.run(dataset, String(key), raw);
          count++;
        }
        progress.run(processed + count, run);
      });
      batch = [];
    };
    console.log('Reading ' + dataset);
    await readEntry(zip, entries.get(dataset), (row, raw) => {
      batch.push([row, raw]);
      if (batch.length >= 1000) flush();
    });
    if (batch.length) flush();
    processed += count;
    console.log(dataset + ': ' + count);
  }

  // Keep existing live metadata and stable episode IDs used by personal records.
  transaction(db, () => {
    for (const { payload } of readRelations.iterate('subject-persons')) {
      const row = JSON.parse(payload);
      const role = staffRoles[row.position];
      const id = workIds.get(row.subject_id);
      const person = role && findPerson.get(row.person_id);
      if (id && person) putStaff.run(id, person.id, role);
    }
    for (const { payload } of readRelations.iterate('subject-characters')) {
      const row = JSON.parse(payload);
      const id = workIds.get(row.subject_id);
      const character = findCharacter.get(row.character_id);
      if (id && character) putCast.run(id, character.id, characterRoles[row.type] || '');
    }
    for (const { payload } of readRelations.iterate('person-characters')) {
      const row = JSON.parse(payload);
      const id = workIds.get(row.subject_id);
      const character = findCharacter.get(row.character_id);
      const person = findPerson.get(row.person_id);
      if (id && character && person) {
        putCast.run(id, character.id, '');
        putVoice.run(id, character.id, person.id);
      }
    }
    db.prepare('UPDATE import_runs SET finished_at=? WHERE id=?').run(
      new Date().toISOString(),
      run,
    );
  });
  return processed;
}

async function main() {
  const zip = process.argv[2] || 'data/archive/bangumi.zip';
  const { stdout } = await execFileAsync('tar', ['-tf', zip], { windowsHide: true });
  const entries = new Map();
  for (const dataset of datasets) {
    const name = dataset + '.jsonlines';
    const entry = stdout.split(/\r?\n/).find((path) => path === name || path.endsWith('/' + name));
    if (!entry) throw new Error('Missing archive entry: ' + name);
    entries.set(dataset, entry);
  }
  const db = openDatabase();
  const run = randomUUID();
  try {
    db.prepare(
      "INSERT INTO import_runs(id,source,started_at) VALUES(?,'bangumi-full-archive',?)",
    ).run(run, new Date().toISOString());
    const processed = await importArchive(db, zip, entries, run);
    console.log(JSON.stringify({ processed, run }));
  } catch (error) {
    db.prepare('UPDATE import_runs SET finished_at=?,error=? WHERE id=?').run(
      new Date().toISOString(),
      error.message,
      run,
    );
    throw error;
  } finally {
    db.close();
  }
}

await main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
