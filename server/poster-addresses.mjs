// Address discovery only: redirect bodies and image files are never downloaded.
export function posterAddress(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'lain.bgm.tv' &&
      !url.port &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export async function discoverPosterAddress(id, { fetchImpl = fetch, signal, userAgent }) {
  const response = await fetchImpl(`https://api.bgm.tv/v0/subjects/${id}/image?type=common`, {
    headers: { 'User-Agent': userAgent },
    redirect: 'manual',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  const location = response.headers.get('location');
  await response.body?.cancel();
  if (response.status === 404) return { status: 'missing' };
  if (response.status === 429 || response.status === 503) {
    const raw = response.headers.get('retry-after');
    const seconds =
      raw && Number.isFinite(Number(raw))
        ? Number(raw)
        : raw
          ? (Date.parse(raw) - Date.now()) / 1000
          : 30;
    return {
      status: 'retry',
      waitMs: Math.max(30000, Number.isFinite(seconds) ? seconds * 1000 : 30000),
    };
  }
  const url = posterAddress(location);
  if (response.status !== 302 || !url)
    throw new Error(`Unexpected image redirect: HTTP ${response.status}`);
  if (/\/img\/no_icon_subject\./.test(url)) return { status: 'missing' };
  return { status: 'ok', url };
}

export async function fillPosterAddresses(
  db,
  {
    signal: externalSignal,
    userAgent,
    fetchImpl = fetch,
    intervalMs = 10,
    concurrency = 100,
    now = Date.now,
    wait,
    onProgress = () => {},
  },
) {
  const internalController = new AbortController();
  const signal = AbortSignal.any([externalSignal, internalController.signal]);
  wait ??= (ms) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(done, ms);
      function done() {
        signal.removeEventListener('abort', abort);
        resolve();
      }
      function abort() {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        reject(signal.reason);
      }
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  concurrency = Math.max(1, Math.min(100, Math.floor(concurrency) || 100));
  const rows = db
    .prepare(
      `SELECT s.id,s.bangumi_id FROM subjects s
    LEFT JOIN poster_sources p ON p.subject_id=s.id
    WHERE (s.image_url IS NULL OR trim(s.image_url)='')
      AND (p.retry_at IS NULL OR p.retry_at<=?)
    ORDER BY s.nsfw ASC,s.rating_count DESC,s.bangumi_id ASC`,
    )
    .all(now());
  const progress = {
    total: rows.length,
    processed: 0,
    saved: 0,
    missing: 0,
    failed: 0,
    requests: 0,
    concurrency,
    intervalMs,
    rateLimits: 0,
    networkErrors: 0,
    targetRate: intervalMs ? 1000 / intervalMs : 0,
  };
  const state = db.prepare(`INSERT INTO poster_sources VALUES(?,?,?,?)
    ON CONFLICT(subject_id) DO UPDATE SET checked_at=excluded.checked_at,status=excluded.status,retry_at=excluded.retry_at`);
  const update = db.prepare(
    `UPDATE subjects SET image_url=? WHERE id=? AND (image_url IS NULL OR trim(image_url)='')`,
  );
  let nextAt = 0;
  let gate = Promise.resolve();
  let currentInterval = intervalMs;
  let generation = 0;
  let consecutiveErrors = 0;
  const outcomes = [],
    completions = [];
  const startedAt = now();
  let stableSince = startedAt;
  let cooldownUntil = 0;
  const recoveryCeilingInterval = 10;
  function resetStability() {
    stableSince = Math.max(now(), cooldownUntil);
    progress.stableSeconds = 0;
  }
  async function publish(extra = {}) {
    const timestamp = now();
    while (completions.length && completions[0] < timestamp - 30000) completions.shift();
    progress.actualRate = Number(
      (completions.length / Math.max(1, Math.min(30, (timestamp - startedAt) / 1000))).toFixed(2),
    );
    progress.stableSeconds = Number((Math.max(0, timestamp - stableSince) / 1000).toFixed(1));
    await onProgress({ ...progress, ...extra });
  }
  function reduceRate(reason, requestGeneration) {
    // Failures from the same in-flight batch only reduce once; failures of the
    // next rate generation can halve again immediately, without a time debounce.
    if (requestGeneration !== generation) return;
    currentInterval = Math.min(4000, Math.max(10, currentInterval * 2));
    generation++;
    progress.intervalMs = currentInterval;
    progress.targetRate = Number((1000 / currentInterval).toFixed(2));
    progress.lastReduction = reason;
    resetStability();
    consecutiveErrors = 0;
    outcomes.length = 0;
  }
  function recordOutcome(failed, requestGeneration) {
    // Even an old in-flight request failing breaks the continuous healthy window.
    if (failed) resetStability();
    if (requestGeneration !== generation) return;
    outcomes.push(failed);
    if (outcomes.length > 20) outcomes.shift();
    consecutiveErrors = failed ? consecutiveErrors + 1 : 0;
    if (consecutiveErrors >= 3 || (outcomes.length === 20 && outcomes.filter(Boolean).length >= 3))
      reduceRate('network_errors', requestGeneration);
    if (
      !failed &&
      now() >= cooldownUntil &&
      now() - stableSince >= 10000 &&
      currentInterval > recoveryCeilingInterval
    ) {
      currentInterval = Math.max(recoveryCeilingInterval, currentInterval / 2);
      generation++;
      progress.intervalMs = currentInterval;
      progress.targetRate = Number((1000 / currentInterval).toFixed(2));
      progress.recoveries = (progress.recoveries || 0) + 1;
      consecutiveErrors = 0;
      outcomes.length = 0;
      resetStability();
    }
  }
  // All workers share one request-start gate, including retries and server cooldowns.
  function requestSlot() {
    const turn = gate.then(async () => {
      while (nextAt > now()) {
        await wait(nextAt - now());
        if (signal.aborted) throw signal.reason;
      }
      if (signal.aborted) throw signal.reason;
      nextAt = now() + currentInterval;
      return generation;
    });
    gate = turn.catch(() => {});
    return turn;
  }
  await publish();
  let cursor = 0;
  async function worker() {
    while (!signal.aborted && cursor < rows.length) {
      const row = rows[cursor++];
      // Normal page visits may already have filled this address since the snapshot.
      if (db.prepare('SELECT image_url FROM subjects WHERE id=?').get(row.id)?.image_url) {
        progress.processed++;
        completions.push(now());
        await publish();
        continue;
      }
      let result;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal.aborted) break;
        let requestGeneration;
        try {
          requestGeneration = await requestSlot();
        } catch (error) {
          if (signal.aborted) break;
          throw error;
        }
        if (signal.aborted) break;
        progress.requests++;
        try {
          result = await discoverPosterAddress(row.bangumi_id, { fetchImpl, signal, userAgent });
          if (result.status !== 'retry') {
            recordOutcome(false, requestGeneration);
            break;
          }
          progress.rateLimits++;
          cooldownUntil = Math.max(cooldownUntil, now() + result.waitMs);
          resetStability();
          reduceRate('upstream_busy', requestGeneration);
          nextAt = Math.max(nextAt, cooldownUntil);
          await publish({ pausedUntil: nextAt });
        } catch (error) {
          if (signal.aborted) break;
          result = { status: 'failed', error: error.message };
          progress.networkErrors++;
          recordOutcome(true, requestGeneration);
          await publish();
          try {
            await wait(2000 * 2 ** attempt);
          } catch (error) {
            if (signal.aborted) break;
            throw error;
          }
        }
      }
      if (signal.aborted) break;
      const timestamp = now();
      if (result?.status === 'ok') {
        db.exec('BEGIN IMMEDIATE');
        try {
          update.run(result.url, row.id);
          state.run(row.id, new Date(timestamp).toISOString(), 'ok', null);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        progress.saved++;
      } else if (result?.status === 'missing') {
        state.run(row.id, new Date(timestamp).toISOString(), 'missing', timestamp + 7 * 86400000);
        progress.missing++;
      } else {
        state.run(
          row.id,
          new Date(timestamp).toISOString(),
          'address_failed',
          Math.max(timestamp + 3600000, nextAt),
        );
        progress.failed++;
      }
      progress.processed++;
      completions.push(now());
      await publish({
        lastId: row.bangumi_id,
        lastStatus: result?.status || 'failed',
      });
    }
  }
  let fatal;
  await Promise.all(
    Array.from({ length: concurrency }, () =>
      worker().catch((error) => {
        if (!signal.aborted) {
          fatal = error;
          internalController.abort(error);
        }
      }),
    ),
  );
  if (fatal) throw fatal;
  return { ...progress, stopped: signal.aborted };
}
