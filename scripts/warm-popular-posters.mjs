import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, open, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { posterService } from '../server/posters.mjs';

const database = resolve(process.env.DATABASE_PATH || 'data/anime-note.sqlite');
const cacheDir = resolve(dirname(database), 'posters');
const directory = resolve('.local/popular-posters');
await mkdir(directory, { recursive: true });
const lockPath = resolve(directory, 'worker.lock');
const lock = await open(lockPath, 'wx');
let db, poster;
try {
  db = new DatabaseSync(database);
  db.exec('PRAGMA busy_timeout=5000');
  const subjects = db
    .prepare(
      `SELECT bangumi_id FROM subjects
    WHERE nsfw=0 AND rating_count>=1000
    ORDER BY rating_count DESC, bangumi_id ASC`,
    )
    .all();

  const status = {
    state: 'running',
    pid: process.pid,
    targetRate: 30,
    total: subjects.length,
    processed: 0,
    cached: 0,
    downloaded: 0,
    newImageBytes: 0,
    missing: 0,
    failed: [],
  };
  const publish = () =>
    writeFile(resolve(directory, 'status.json'), JSON.stringify(status, null, 2));
  await publish();
  let cooldownUntil = 0;
  let nextStart = 0;
  let generation = 0;
  let healthySince = null;
  let gate = Promise.resolve();
  const attempts = new AsyncLocalStorage();

  function failure(requestGeneration, error) {
    healthySince = null;
    if (error.code === 'upstream_busy') {
      cooldownUntil = Math.max(cooldownUntil, performance.now() + (error.retryAfter || 30) * 1000);
    }
    // In-flight failures from one rate setting reset the clock, but halve only once.
    if (requestGeneration === generation) {
      status.targetRate = Math.max(0.25, status.targetRate / 2);
      generation++;
    }
  }

  async function pacedFetch(url, options) {
    const slot = gate.then(async () => {
      let delay;
      while ((delay = Math.max(nextStart, cooldownUntil) - performance.now()) > 0)
        await pause(Math.ceil(delay), undefined, { signal: options.signal });
      options.signal.throwIfAborted();
      nextStart = performance.now() + 1000 / status.targetRate;
      return generation;
    });
    gate = slot.catch(() => {});
    const attempt = attempts.getStore();
    const startedGeneration = await slot;
    if (attempt) attempt.generation = startedGeneration;
    return fetch(url, options);
  }
  poster = posterService(db, {
    cacheDir,
    concurrency: 16,
    fetchImpl: pacedFetch,
    networkTimeoutMs: 45000,
  });

  const pending = [];
  for (const { bangumi_id: id } of subjects) {
    const existing = await readFile(resolve(cacheDir, `${id}.json`), 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    if (existing?.base64 && existing.type?.startsWith('image/') && existing.etag) {
      status.cached++;
      status.processed++;
    } else pending.push(id);
  }
  await publish();
  const timer = setInterval(() => {
    publish().catch((error) => console.error(error));
  }, 1000);
  let cursor = 0;
  async function worker(_, index) {
    while (cursor < pending.length) {
      if (index >= Math.max(1, Math.ceil(status.targetRate))) {
        await pause(250);
        continue;
      }
      const id = pending[cursor++];
      for (let attempt = 0; attempt < 3; attempt++) {
        const request = { generation };
        try {
          const entry = await attempts.run(request, () => poster(id));
          if (!entry) status.missing++;
          else if (entry.cache === 'MISS') {
            status.downloaded++;
            status.newImageBytes += Buffer.byteLength(entry.base64, 'base64');
            if (request.generation === generation && performance.now() >= cooldownUntil) {
              healthySince ??= performance.now();
              if (performance.now() - healthySince >= 5000 && status.targetRate < 30) {
                status.targetRate = Math.min(30, status.targetRate * 2);
                generation++;
                healthySince = null;
              }
            }
          } else status.cached++;
          break;
        } catch (error) {
          if (error.status === 404) {
            status.missing++;
            break;
          }
          failure(request.generation, error);
          if (attempt === 2) {
            status.failed.push({ id, code: error.code || error.message });
            break;
          }
          await pause(Math.max(2, error.retryAfter || 5) * 1000);
        }
      }
      status.processed++;
    }
  }
  try {
    await Promise.all(Array.from({ length: 16 }, worker));
  } finally {
    clearInterval(timer);
  }
  status.state = status.failed.length ? 'completed_with_errors' : 'completed';
  await publish();
} finally {
  poster?.close();
  db?.close();
  await lock.close();
  await unlink(lockPath);
}
