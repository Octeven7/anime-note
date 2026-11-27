import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoBackup } from './auto-backup.mjs';
import { restorePersonal } from './backup.mjs';
import { upsertSubject } from './catalog.mjs';
import { openDatabase } from './database.mjs';
import { createNote, getNote, saveDraft } from './personal.mjs';

test('单份备份可恢复，未到期不覆盖，预检失败仍保留上一份', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paper-screen-backup-'));
  const db = openDatabase(':memory:');
  const target = openDatabase(':memory:');
  let clock = Date.now();
  const backup = autoBackup(db, { directory, now: () => clock });
  try {
    const subjectId = upsertSubject(db, { id: 123, type: 2, name: '备份测试' });
    const note = createNote(db, { subjectId, scope: 'overall', body: '第一版草稿' });
    await backup.check();
    const file = backup.status().file;
    const first = await readFile(file, 'utf8');
    restorePersonal(target, JSON.parse(first));
    assert.equal(getNote(target, note.id).draft.body, '第一版草稿');
    saveDraft(db, note.id, { expectedVersion: note.version, body: '新版草稿' });
    await backup.check();
    assert.equal(await readFile(file, 'utf8'), first);
    clock += 25 * 60 * 60 * 1000;
    await backup.check();
    const second = await readFile(file, 'utf8');
    assert.equal(JSON.parse(second).data.drafts[0].body, '新版草稿');
    assert.deepEqual(await readdir(directory), ['paper-screen-personal.json']);
    db.prepare("UPDATE note_drafts SET updated_at='invalid' WHERE note_id=?").run(note.id);
    clock += 25 * 60 * 60 * 1000;
    await backup.check();
    assert.ok(backup.status().error);
    assert.equal(await readFile(file, 'utf8'), second);
  } finally {
    backup.close();
    db.close();
    target.close();
    await rm(directory, { recursive: true, force: true });
  }
});
