import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
  existsSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { fillPosterAddresses } from '../server/poster-addresses.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.loadEnvFile && existsSync('.env') && process.loadEnvFile('.env');
const directory = resolve('.local/poster-addresses');
mkdirSync(directory, { recursive: true });
const lock = resolve(directory, 'worker.lock'),
  stop = resolve(directory, 'stop'),
  statusFile = resolve(directory, 'status.json');
const readStatus = () => {
  try {
    return JSON.parse(readFileSync(statusFile, 'utf8'));
  } catch {
    return {};
  }
};
const live = () => {
  try {
    const pid = Number(readFileSync(lock, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const mode = process.argv[2] || '--start';
if (mode === '--status') {
  console.log(JSON.stringify({ ...readStatus(), running: live() }, null, 2));
} else if (mode === '--stop') {
  if (live()) {
    writeFileSync(stop, 'stop');
    console.log('Stop requested. Saved addresses are retained.');
  } else console.log('No address worker is running.');
} else if (mode === '--start') {
  if (live()) {
    console.log('Address worker is already running.');
    process.exit(0);
  }
  const out = openSync(resolve(directory, 'worker.log'), 'a');
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--run'], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, out],
    });
    await new Promise((r, j) => {
      child.once('spawn', r);
      child.once('error', j);
    });
    child.unref();
    console.log(`Started independent address worker (PID ${child.pid}). Logs: ${directory}`);
  } finally {
    closeSync(out);
  }
} else if (mode === '--run') {
  if (live()) {
    console.log('Another worker holds the lock.');
    process.exit(0);
  }
  if (existsSync(lock)) unlinkSync(lock);
  try {
    writeFileSync(lock, String(process.pid), { flag: 'wx' });
  } catch {
    console.log('Another worker started.');
    process.exit(0);
  }
  if (existsSync(stop)) unlinkSync(stop);
  const controller = new AbortController();
  let db, timer;
  const previous = readStatus();
  const base = previous.state === 'stopped' ? previous : {};
  const cumulative = (progress) => {
    const result = { ...progress };
    for (const key of ['processed', 'saved', 'missing', 'failed', 'requests'])
      result[key] = (base[key] || 0) + (progress[key] || 0);
    result.total = (base.processed || 0) + progress.total;
    return result;
  };
  let status = { state: 'starting', pid: process.pid, startedAt: new Date().toISOString() };
  const publish = (extra) => {
    status = { ...status, ...extra, updatedAt: new Date().toISOString() };
    writeFileSync(statusFile, JSON.stringify(status, null, 2));
  };
  try {
    publish({});
    const database = resolve(process.env.DATABASE_PATH || 'data/anime-note.sqlite');
    if (!existsSync(database)) throw new Error('Database not found. Start the website once first.');
    db = new DatabaseSync(database);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
    db.prepare('SELECT subject_id,checked_at,status,retry_at FROM poster_sources LIMIT 1').get();
    timer = setInterval(() => {
      if (existsSync(stop)) controller.abort(new Error('Stopped by user'));
    }, 500);
    process.once('SIGINT', () => controller.abort());
    process.once('SIGTERM', () => controller.abort());
    const result = await fillPosterAddresses(db, {
      signal: controller.signal,
      intervalMs: Math.max(10, Math.min(4000, Number(base.intervalMs) || 10)),
      userAgent:
        process.env.BANGUMI_USER_AGENT || 'paper-screen/0.2.0',
      onProgress: (progress) => {
        publish({ state: 'running', ...cumulative(progress) });
        if (progress.processed % 100 === 0)
          console.log(new Date().toISOString(), JSON.stringify(progress));
      },
    });
    publish({
      ...cumulative(result),
      state: result.stopped ? 'stopped' : result.failed ? 'completed_with_errors' : 'completed',
    });
    console.log(new Date().toISOString(), JSON.stringify(status));
  } catch (error) {
    if (controller.signal.aborted) publish({ state: 'stopped' });
    else {
      publish({ state: 'failed', error: error.message });
      console.error(error);
      process.exitCode = 1;
    }
  } finally {
    clearInterval(timer);
    db?.close();
    try {
      if (readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock);
    } catch {}
  }
} else {
  console.error('Usage: poster-addresses.mjs --start | --status | --stop');
  process.exitCode = 1;
}
