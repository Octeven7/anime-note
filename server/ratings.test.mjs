import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './database.mjs';
import { upsertSubject, searchCatalog, getSubject } from './catalog.mjs';
import { distribution } from './ratings.mjs';
import { ratingRefresher } from './rating-refresh.mjs';
const counts = (eight, nine) =>
  Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [i + 1, i === 7 ? eight : i === 8 ? nine : 0]),
  );
const raw = (id, c) => ({
  id,
  type: 2,
  name: '作品' + id,
  rating: { score: 8.1, total: Object.values(c).reduce((a, b) => a + b, 0), count: c, rank: id },
});
test('精确均分优先于同分人数；保存十档分布、未评分及归档不覆盖API', () => {
  const db = openDatabase(':memory:');
  try {
    const a = upsertSubject(db, raw(1, counts(900, 100)), { tagSource: 'api' });
    const b = upsertSubject(db, raw(2, counts(88, 12)), { tagSource: 'api' });
    assert.deepEqual(
      searchCatalog(db, new URLSearchParams()).items.map((x) => x.id),
      [b, a],
    );
    assert.equal(getSubject(db, b).score_exact, 8.12);
    assert.equal(getSubject(db, b).rating_distribution['9'], 12);
    upsertSubject(db, raw(2, counts(100, 0)), { tagSource: 'archive' });
    assert.equal(getSubject(db, b).score_exact, 8.12);
    assert.equal(getSubject(db, b).score, 8.1);
    assert.equal(distribution({ rating: { count: counts(1, 1), total: 3 } }), null);
    const z = upsertSubject(db, raw(3, counts(0, 0)));
    assert.equal(getSubject(db, z).score_exact, null);
  } finally {
    db.close();
  }
});
test('后台刷新合并请求、立即返回缓存、失败保留旧值且冷却，关闭后不写库', async () => {
  const db = openDatabase(':memory:');
  let worker;
  try {
    const id = upsertSubject(db, raw(1, counts(90, 10)));
    let resolve,
      calls = 0;
    worker = ratingRefresher(
      db,
      {
        request: () => {
          calls++;
          return new Promise((r) => (resolve = r));
        },
      },
      { startDelayMs: 0, intervalMs: 100000 },
    );
    assert.equal(worker.state([{ id }]).pending, true);
    const task = worker.tick();
    await worker.tick();
    assert.equal(calls, 1);
    assert.equal(getSubject(db, id).score_exact, 8.1);
    resolve(raw(1, counts(50, 50)));
    await task;
    assert.equal(getSubject(db, id).score_exact, 8.5);
    assert.equal(worker.state([{ id }]).pending, false);
    worker.close();
    const id2 = upsertSubject(db, raw(2, counts(90, 10)));
    worker = ratingRefresher(
      db,
      {
        request: async () => {
          throw new Error('offline');
        },
      },
      { startDelayMs: 0, intervalMs: 100000 },
    );
    worker.state([{ id: id2 }]);
    await worker.tick();
    assert.equal(getSubject(db, id2).score_exact, 8.1);
    assert.equal(worker.state([{ id: id2 }]).pending, false);
    assert.equal(
      db.prepare('select last_error from subject_ratings where subject_id=?').get(id2).last_error,
      'offline',
    );
    worker.close();
    worker = ratingRefresher(
      db,
      { request: () => new Promise((r) => (resolve = r)) },
      { startDelayMs: 0, intervalMs: 100000, now: () => Date.now() + 16 * 60000 },
    );
    worker.state([{ id: id2 }]);
    const closing = worker.tick();
    worker.close();
    resolve(raw(2, counts(0, 100)));
    await closing;
    assert.equal(getSubject(db, id2).score_exact, 8.1);
  } finally {
    worker?.close();
    db.close();
  }
});
