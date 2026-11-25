import { normalize } from './catalog.mjs';
import { syncTag } from './catalog-sync.mjs';
export function tagIndexer(db, client) {
  const jobs = new Map();
  let closed = false;
  return {
    close() {
      closed = true;
    },
    state(input) {
      const tags = [...new Set(input.map((value) => normalize(value).trim()).filter(Boolean))];
      const states = tags.map((tag) => {
        if (jobs.has(tag)) return { tag, pending: true, ...jobs.get(tag).progress };
        const cached = db.prepare('SELECT * FROM tag_query_sync WHERE tag=?').get(tag);
        if (
          cached?.fetched_at &&
          Date.now() - Date.parse(cached.fetched_at) < 7 * 86400000 &&
          !cached.last_error
        )
          return { tag, pending: false, matched: cached.matched, fetchedAt: cached.fetched_at };
        if (cached?.last_error && Date.now() - Date.parse(cached.last_attempt_at) < 5 * 60000)
          return { tag, pending: false, error: cached.last_error };
        if (closed || typeof client.searchTag !== 'function') return { tag, pending: false };
        db.prepare(
          'INSERT INTO tag_query_sync(tag,last_attempt_at) VALUES(?,?) ON CONFLICT(tag) DO UPDATE SET last_attempt_at=excluded.last_attempt_at',
        ).run(tag, new Date().toISOString());
        const job = { progress: {}, promise: null };
        jobs.set(tag, job);
        job.promise = Promise.resolve()
          .then(() =>
            syncTag(db, client, tag, {
              isCancelled: () => closed,
              onProgress: (value) => {
                job.progress = value;
              },
            }),
          )
          .catch((error) => {
            if (!closed)
              db.prepare('UPDATE tag_query_sync SET last_error=? WHERE tag=?').run(
                error.message,
                tag,
              );
          })
          .finally(() => jobs.delete(tag));
        return { tag, pending: true };
      });
      return { pending: states.some((row) => row.pending), states };
    },
  };
}
