import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.mjs';
test('归档CLI逐行过滤动画，重复导入无重复，错误可追踪', () => {
  const dir = mkdtempSync(join(tmpdir(), 'anime-import-'));
  try {
    const path = join(dir, 'subject.jsonlines'),
      database = join(dir, 'test.sqlite');
    const anime = {
      id: 1,
      type: 2,
      name: '测试动画',
      name_cn: '',
      infobox: '{{Infobox}}',
      tags: [{ name: 'TV' }, { name: 'tv' }],
      score: 8,
      score_details: { 1: 0, 8: 10 },
    };
    writeFileSync(
      path,
      [JSON.stringify({ id: 2, type: 1, name: '书籍' }), JSON.stringify(anime)].join('\n'),
    );
    const run = () =>
      spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./import.mjs', import.meta.url)), 'archive', path],
        { env: { ...process.env, DATABASE_PATH: database }, encoding: 'utf8' },
      );
    assert.equal(run().status, 0);
    assert.equal(run().status, 0);
    let db = openDatabase(database);
    assert.equal(db.prepare('SELECT count(*) n FROM subjects').get().n, 1);
    assert.equal(db.prepare('SELECT rating_count FROM subjects').get().rating_count, 10);
    db.close();
    writeFileSync(path, 'invalid JSON');
    assert.equal(run().status, 1);
    db = openDatabase(database);
    assert.match(
      db.prepare('SELECT error FROM import_runs ORDER BY started_at DESC LIMIT 1').get().error,
      /Line 1/,
    );
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
