import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const WEEK = 7 * 86400000;
const safe = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' &&
      u.hostname === 'lain.bgm.tv' &&
      !u.port &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
};
const noIcon = (url) => /\/img\/no_icon_subject\./.test(url);
const retrySeconds = (value, now) => {
  if (!value) return 30;
  const n = Number(value);
  return Math.max(5, Math.ceil(Number.isFinite(n) ? n : (Date.parse(value) - now) / 1000) || 30);
};
export class PosterError extends Error {
  constructor(code, status = 502, retryAfter = 5) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
export function posterService(
  db,
  {
    fetchImpl = fetch,
    cacheDir = (() => {
      const f = db.prepare('PRAGMA database_list').get().file;
      return f ? join(dirname(f), 'posters') : null;
    })(),
    readOnlyCache = false,
    userAgent = process.env.BANGUMI_USER_AGENT || 'paper-screen/0.2.0',
    concurrency = Number(process.env.POSTER_CONCURRENCY || 6),
    backgroundLimit = 2,
    queueTimeoutMs = 15000,
    networkTimeoutMs = 10000,
    now = Date.now,
  } = {},
) {
  concurrency = Math.max(1, Math.min(16, Math.floor(concurrency) || 6));
  backgroundLimit = Math.min(backgroundLimit, Math.max(1, concurrency - 1));
  const jobs = new Map(),
    failures = new Map(),
    records = [];
  let active = 0,
    backgroundActive = 0,
    closed = false;
  let pausedUntil = 0,
    resumeTimer;
  function log(r) {
    records.push(r);
    if (records.length > 1000) records.shift();
  }
  function sourceState(id, status, retry = 0) {
    if (closed) return;
    db.prepare(
      'INSERT INTO poster_sources VALUES(?,?,?,?) ON CONFLICT(subject_id) DO UPDATE SET checked_at=excluded.checked_at,status=excluded.status,retry_at=excluded.retry_at',
    ).run(id, new Date(now()).toISOString(), status, retry || null);
  }
  function status(id) {
    const subject = db.prepare('SELECT id FROM subjects WHERE bangumi_id=? AND nsfw=0').get(id);
    if (!subject) return { status: 'none', httpStatus: 404, retryAfter: 0 };
    const p = db.prepare('SELECT * FROM poster_sources WHERE subject_id=?').get(subject.id);
    if (p?.status === 'missing' && p.retry_at > now())
      return { status: 'none', httpStatus: 404, retryAfter: 0 };
    const f = failures.get(id);
    if (f && f.until <= now()) failures.delete(id);
    if (f && f.until > now())
      return {
        status: f.error.code,
        httpStatus: f.error.status,
        retryAfter: Math.max(1, Math.ceil((f.until - now()) / 1000)),
      };
    return { status: jobs.has(id) ? 'loading' : 'ready', httpStatus: 200, retryAfter: 0 };
  }
  function pump() {
    if (closed) return;
    if (now() < pausedUntil) {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(pump, pausedUntil - now());
      resumeTimer.unref?.();
      return;
    }
    while (active < concurrency) {
      const pending = [...jobs.values()].filter((j) => !j.started);
      const job =
        pending.find((j) => j.foreground) ||
        pending.find((j) => backgroundActive < backgroundLimit);
      if (!job) break;
      job.started = true;
      clearTimeout(job.timer);
      job.deadlineTimer = setTimeout(
        () => {
          job.expired = true;
          job.controller.abort();
        },
        Math.max(1, 25000 - (performance.now() - job.enqueued)),
      );
      active++;
      if (!job.foreground) {
        job.wasBackground = true;
        backgroundActive++;
      }
      void run(job).finally(() => {
        active--;
        if (job.wasBackground) backgroundActive--;
        pump();
      });
    }
  }
  async function resolveURL(job) {
    const t = performance.now();
    const r = await fetchImpl(`https://api.bgm.tv/v0/subjects/${job.id}/image?type=common`, {
      headers: { 'User-Agent': userAgent },
      redirect: 'manual',
      signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(networkTimeoutMs)]),
    });
    job.metrics.resolve = (job.metrics.resolve || 0) + performance.now() - t;
    const url = safe(r.headers.get('location'));
    await r.body?.cancel();
    if (r.status === 429 || r.status === 503)
      throw new PosterError(
        'upstream_busy',
        503,
        retrySeconds(r.headers.get('retry-after'), now()),
      );
    if (r.status === 404 || (url && noIcon(url))) {
      sourceState(job.subject.id, 'missing', now() + 86400000);
      throw new PosterError('none', 404, 0);
    }
    if (r.status !== 302 || !url) throw new PosterError('address_failed');
    if (closed) throw new PosterError('cancelled', 499, 0);
    db.prepare('UPDATE subjects SET image_url=? WHERE id=?').run(url, job.subject.id);
    sourceState(job.subject.id, 'ok');
    return url;
  }
  async function run(job) {
    const m = job.metrics;
    m.queue = performance.now() - job.enqueued;
    try {
      let url = safe(job.subject.image_url);
      if (url && noIcon(url)) {
        sourceState(job.subject.id, 'missing', now() + 86400000);
        throw new PosterError('none', 404, 0);
      }
      if (!url) url = await resolveURL(job);
      let data, type;
      for (let pass = 0; pass < 2; pass++) {
        const target = new URL(url).pathname.startsWith('/pic/cover/')
          ? url.replace('https://lain.bgm.tv/pic/', 'https://lain.bgm.tv/r/400/pic/')
          : url;
        const t = performance.now();
        const response = await fetchImpl(target, {
          headers: { 'User-Agent': userAgent },
          redirect: 'error',
          signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(networkTimeoutMs)]),
        });
        m.ttfb = (m.ttfb || 0) + performance.now() - t;
        type = response.headers.get('content-type')?.split(';')[0];
        if (response.status === 429 || response.status === 503) {
          await response.body?.cancel();
          throw new PosterError(
            'upstream_busy',
            503,
            retrySeconds(response.headers.get('retry-after'), now()),
          );
        }
        if (
          [403, 404, 410].includes(response.status) ||
          (response.ok &&
            !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(type))
        ) {
          await response.body?.cancel();
          if (pass === 0) {
            url = await resolveURL(job);
            continue;
          }
          throw new PosterError('image_unavailable', 502, 30);
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new PosterError('upstream_failed');
        }
        const chunks = [];
        let bytes = 0;
        const bodyAt = performance.now();
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > 5 * 1024 * 1024) throw new PosterError('too_large', 502, 30);
          chunks.push(chunk);
        }
        m.body = (m.body || 0) + performance.now() - bodyAt;
        m.bytes = bytes;
        data = Buffer.concat(chunks);
        break;
      }
      if (!data?.length) throw new PosterError('empty_image');
      if (closed || job.controller.signal.aborted) throw new PosterError('cancelled', 499, 0);
      const entry = {
        type,
        base64: data.toString('base64'),
        fetchedAt: now(),
        etag: `"${createHash('sha256').update(data).digest('hex')}"`,
      };
      const diskAt = performance.now();
      if (cacheDir && !readOnlyCache) {
        await mkdir(cacheDir, { recursive: true });
        const file = join(cacheDir, `${job.id}.json`),
          temp = file + '.' + randomUUID() + '.tmp';
        try {
          await writeFile(temp, JSON.stringify(entry));
          await rename(temp, file);
        } finally {
          await unlink(temp).catch(() => {});
        }
      }
      m.disk = performance.now() - diskAt;
      failures.delete(job.id);
      job.resolve({ ...entry, cache: 'MISS', timing: m });
      log({ id: job.id, kind: job.foreground ? 'foreground' : 'background', status: 'ok', ...m });
    } catch (e) {
      const error =
        e instanceof PosterError
          ? e
          : job.expired
            ? new PosterError('total_timeout', 503, 5)
            : new PosterError(
                job.controller.signal.aborted
                  ? 'cancelled'
                  : e.name === 'TimeoutError'
                    ? 'timeout'
                    : 'network_error',
                job.controller.signal.aborted ? 499 : 502,
                5,
              );
      if (error.code === 'upstream_busy') pausedUntil = now() + error.retryAfter * 1000;
      if (error.status !== 499) {
        if (failures.size >= 1000) failures.delete(failures.keys().next().value);
        failures.set(job.id, {
          error,
          background: !job.foreground,
          until:
            now() + 1000 * (job.foreground ? error.retryAfter : Math.max(30, error.retryAfter)),
        });
      }
      error.timing = m;
      job.reject(error);
      log({ id: job.id, status: error.code, ...m });
    } finally {
      clearTimeout(job.deadlineTimer);
      jobs.delete(job.id);
    }
  }
  function enqueue(id, subject, foreground, signal) {
    if (signal?.aborted) return Promise.reject(new PosterError('cancelled', 499, 0));
    let job = jobs.get(id);
    if (job && foreground) job.foreground = true;
    if (!job) {
      const bg = [...jobs.values()].filter((j) => !j.started && !j.foreground);
      if (!foreground && bg.length >= 8) {
        const old = bg[0];
        jobs.delete(old.id);
        clearTimeout(old.timer);
        old.reject(new PosterError('superseded', 499, 0));
      }
      let resolve, reject;
      const promise = new Promise((a, b) => {
        resolve = a;
        reject = b;
      });
      job = {
        id,
        subject,
        foreground,
        started: false,
        consumers: 0,
        controller: new AbortController(),
        enqueued: performance.now(),
        metrics: {},
        resolve,
        reject,
        promise,
      };
      jobs.set(id, job);
      job.timer = setTimeout(() => {
        if (!job.started) {
          jobs.delete(id);
          const error = new PosterError('queue_timeout', 503, 2);
          error.timing = { queue: performance.now() - job.enqueued };
          log({ id, status: error.code, ...error.timing });
          job.reject(error);
          pump();
        }
      }, queueTimeoutMs);
    }
    job.consumers++;
    pump();
    return new Promise((resolve, reject) => {
      let finished = false;
      const end = () => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener('abort', abort);
        job.consumers--;
        return true;
      };
      const abort = () => {
        if (!end()) return;
        reject(new PosterError('cancelled', 499, 0));
        if (job.consumers === 0) {
          if (job.started) job.controller.abort();
          else {
            clearTimeout(job.timer);
            jobs.delete(id);
            job.reject(new PosterError('cancelled', 499, 0));
            pump();
          }
        }
      };
      signal?.addEventListener('abort', abort, { once: true });
      job.promise.then(
        (x) => {
          if (end()) resolve(x);
        },
        (e) => {
          if (end()) reject(e);
        },
      );
      if (signal?.aborted) abort();
    });
  }
  const poster = async (id, { priority = true, signal } = {}) => {
    const subject = db
      .prepare('SELECT id,image_url FROM subjects WHERE bangumi_id=? AND nsfw=0')
      .get(id);
    if (!subject) return null;
    if (closed) throw new PosterError('cancelled', 499, 0);
    const t = performance.now();
    if (subject.image_url && noIcon(subject.image_url)) {
      sourceState(subject.id, 'missing', now() + 86400000);
      throw new PosterError('none', 404, 0);
    }
    if (cacheDir) {
      try {
        const entry = JSON.parse(await readFile(join(cacheDir, `${id}.json`), 'utf8'));
        if (entry.base64 && entry.type?.startsWith('image/') && entry.etag) {
          const stale = now() - entry.fetchedAt > WEEK;
          status(id); // Expire a past refresh failure before deciding to refresh again.
          if (!readOnlyCache && stale && !jobs.has(id) && !failures.has(id))
            void enqueue(id, subject, false).catch(() => {});
          return {
            ...entry,
            cache: stale ? 'STALE' : 'HIT',
            timing: { cache: performance.now() - t },
          };
        }
      } catch {}
    }
    if (now() < pausedUntil)
      throw new PosterError(
        'upstream_busy',
        503,
        Math.max(1, Math.ceil((pausedUntil - now()) / 1000)),
      );
    const state = status(id);
    const failure = failures.get(id);
    if (state.httpStatus !== 200) {
      if (!(priority && failure?.background && failure.error.status !== 404)) {
        throw new PosterError(state.status, state.httpStatus, state.retryAfter);
      }
      failures.delete(id);
    }
    return enqueue(id, subject, priority, signal);
  };
  poster.status = status;
  poster.diagnostics = () => ({
    concurrency,
    backgroundLimit,
    active,
    backgroundActive,
    queued: jobs.size - active,
    records: [...records],
  });
  poster.close = () => {
    closed = true;
    clearTimeout(resumeTimer);
    for (const job of jobs.values()) {
      clearTimeout(job.timer);
      if (job.started) job.controller.abort();
      else job.reject(new PosterError('cancelled', 499, 0));
    }
    jobs.clear();
  };
  return poster;
}
export const posterTiming = (m) =>
  Object.entries(m || {})
    .filter(([k]) => k !== 'bytes')
    .map(([k, v]) => `poster_${k};dur=${Number(v).toFixed(1)}`)
    .join(', ');
