import { randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { exportPersonal, restorePersonal } from './backup.mjs';
import { openDatabase } from './database.mjs';

const DAY = 24 * 60 * 60 * 1000;

export function autoBackup(db, { directory = '', now = Date.now } = {}) {
  const file =
    directory && isAbsolute(directory) ? join(directory, 'paper-screen-personal.json') : null;
  const state = {
    enabled: Boolean(directory),
    file,
    lastSuccess: null,
    error: directory && !file ? 'PERSONAL_BACKUP_DIR 必须是绝对路径。' : null,
  };
  let timer, inFlight;
  let closed = false;

  async function run() {
    let temporary;
    try {
      if (!state.lastSuccess) {
        try {
          const previous = JSON.parse(await readFile(file, 'utf8'));
          if (
            previous.format === 'paper-screen-personal' &&
            Number.isFinite(Date.parse(previous.exportedAt))
          )
            state.lastSuccess = previous.exportedAt;
        } catch (error) {
          if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        }
      }
      if (closed) return;
      if (state.lastSuccess && now() - Date.parse(state.lastSuccess) < DAY) return;
      const backup = exportPersonal(db);
      const serialized = JSON.stringify(backup, null, 2);
      const check = openDatabase(':memory:');
      try {
        restorePersonal(check, JSON.parse(serialized), { dryRun: true });
      } finally {
        check.close();
      }
      temporary = file + '.' + randomUUID() + '.tmp';
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (closed) return;
      await rename(temporary, file);
      state.lastSuccess = backup.exportedAt;
      state.error = null;
    } catch (error) {
      state.error = `自动备份失败（${error.code || error.message}）。请检查备份目录是否可写。`;
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
    }
  }
  function check() {
    if (!file || closed) return;
    inFlight ??= run().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }
  return {
    status: () => ({ ...state }),
    check,
    start() {
      if (!file || timer || closed) return;
      void check();
      timer = setInterval(check, 15 * 60 * 1000);
      timer.unref();
    },
    close() {
      closed = true;
      clearInterval(timer);
    },
  };
}
