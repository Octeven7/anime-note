import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.mjs';
import { storeBundle } from './catalog.mjs';
import { createNote, listNotes } from './personal.mjs';
test('CLI备份文件可恢复到新库且拒绝覆盖已有备份文件', () => {
  const dir = mkdtempSync(join(tmpdir(), 'personal-backup-'));
  try {
    const source = join(dir, 'source.sqlite'),
      target = join(dir, 'target.sqlite'),
      output = join(dir, 'backup.json');
    const db = openDatabase(source);
    const sid = storeBundle(db, {
      subject: { id: 1, type: 2, name: '测试' },
      episodes: [],
      characters: [],
      persons: [],
    });
    createNote(db, { subjectId: sid, scope: 'overall', body: '跨数据库恢复' });
    db.close();
    const run = (database, args) =>
      spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./personal-cli.mjs', import.meta.url)), ...args],
        { env: { ...process.env, DATABASE_PATH: database }, encoding: 'utf8' },
      );
    assert.equal(run(source, ['export', output]).status, 0);
    assert.ok(existsSync(output));
    assert.equal(run(source, ['export', output]).status, 1);
    assert.equal(run(target, ['restore', output, '--dry-run']).status, 0);
    let restored = openDatabase(target);
    assert.equal(listNotes(restored, new URLSearchParams()).total, 0);
    restored.close();
    assert.equal(run(target, ['restore', output]).status, 0);
    restored = openDatabase(target);
    assert.equal(listNotes(restored, new URLSearchParams()).items[0].draft.body, '跨数据库恢复');
    restored.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
