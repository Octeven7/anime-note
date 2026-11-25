import { openDatabase } from './database.mjs';
import { searchCatalog } from './catalog.mjs';
const db = openDatabase();
try {
  const integrity = db.prepare('PRAGMA integrity_check').all();
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  const mismatch = db
    .prepare(
      'SELECT count(*) n FROM subjects s LEFT JOIN subject_search f ON f.rowid=s.rowid WHERE f.subject_id IS NULL OR f.subject_id<>s.id',
    )
    .get().n;
  if (integrity.some((r) => r.integrity_check !== 'ok') || foreignKeys.length || mismatch)
    throw new Error(`Integrity failure: ${JSON.stringify({ integrity, foreignKeys, mismatch })}`);
  const count = db.prepare('SELECT count(*) total,sum(nsfw=0) searchable FROM subjects').get();
  console.log(JSON.stringify({ integrity: 'ok', foreignKeys: 'ok', ftsRowids: 'ok', ...count }));
  for (const query of [
    'q=芙莉莲',
    'q=ぼっち',
    'year=2023&quarter=3&minScore=8&minVotes=100&tag=奇幻',
  ]) {
    const started = performance.now();
    const result = searchCatalog(db, new URLSearchParams(query));
    console.log(
      JSON.stringify({
        query,
        total: result.total,
        ms: Math.round((performance.now() - started) * 100) / 100,
        examples: result.items
          .slice(0, 3)
          .map((s) => ({ id: s.id, bangumiId: s.bangumi_id, title: s.name_cn || s.name })),
      }),
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
