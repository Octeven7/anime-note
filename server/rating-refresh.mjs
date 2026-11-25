import { distribution, storeRatings } from './ratings.mjs';
import { transaction } from './database.mjs';

// One upstream job at a time; visible works take priority over catalog maintenance.
export function ratingRefresher(
  db,
  client,
  { intervalMs = 2000, startDelayMs = 15000, now = () => Date.now() } = {},
) {
  const queue = new Set(),
    attempts = new Map();
  let closed = false,
    busy = false,
    activeId = null,
    pausedUntil = 0;
  const due = (id) => {
    const row = db
      .prepare('SELECT fetched_at,source,last_attempt_at FROM subject_ratings WHERE subject_id=?')
      .get(id);
    return (
      (!row || row.source !== 'api' || now() - Date.parse(row.fetched_at) >= 6 * 3600000) &&
      now() -
        Math.max(
          attempts.get(id) ?? -Infinity,
          row?.last_attempt_at ? Date.parse(row.last_attempt_at) : -Infinity,
        ) >=
        15 * 60000
    );
  };
  async function tick() {
    if (closed || busy || now() < pausedUntil || typeof client.request !== 'function') return;
    let id = queue.values().next().value;
    if (!id) {
      const cutoff = new Date(now() - 7 * 86400000).toISOString();
      id = db
        .prepare(
          `SELECT s.id FROM subjects s LEFT JOIN subject_ratings r ON r.subject_id=s.id WHERE s.nsfw=0 AND (r.fetched_at IS NULL OR r.source='archive' OR r.fetched_at<?) AND (r.last_attempt_at IS NULL OR r.last_attempt_at<?) ORDER BY s.rating_count DESC LIMIT 100`,
        )
        .all(cutoff, new Date(now() - 15 * 60000).toISOString())
        .find((row) => now() - (attempts.get(row.id) ?? -Infinity) >= 15 * 60000)?.id;
    }
    if (!id) return;
    queue.delete(id);
    if (!due(id)) return;
    busy = true;
    activeId = id;
    attempts.set(id, now());
    try {
      const s = db.prepare('SELECT bangumi_id FROM subjects WHERE id=? AND nsfw=0').get(id);
      if (!s) return;
      const raw = await client.request(`/v0/subjects/${s.bangumi_id}`);
      if (closed) return;
      if (raw.id !== s.bangumi_id || raw.type !== 2 || raw.nsfw || !distribution(raw))
        throw new Error('评分分布无效，保留原有数据');
      transaction(db, () => storeRatings(db, id, raw, new Date(now()).toISOString(), 'api'));
    } catch (error) {
      if (!closed)
        db.prepare(
          'UPDATE subject_ratings SET last_attempt_at=?,last_error=? WHERE subject_id=?',
        ).run(new Date(now()).toISOString(), error.message, id);
      if ([401, 403, 429].includes(error.upstreamStatus)) pausedUntil = now() + 30 * 60000;
    } finally {
      busy = false;
      activeId = null;
    }
  }
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  // Preserve the startup budget for the initial page and its posters.
  pausedUntil = now() + startDelayMs;
  return {
    state(items) {
      if (typeof client.request !== 'function') return { pending: false };
      for (const item of items) if (queue.size < 100 && due(item.id)) queue.add(item.id);
      return {
        pending: items.some((item) => item.id === activeId || (due(item.id) && queue.has(item.id))),
        intervalHours: 6,
      };
    },
    tick,
    close() {
      closed = true;
      clearInterval(timer);
      queue.clear();
    },
  };
}
