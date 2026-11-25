import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './database.mjs';
import { upsertSubject } from './catalog.mjs';
import { fillPosterAddresses, discoverPosterAddress } from './poster-addresses.mjs';

test('recovery requires ten uninterrupted healthy seconds at each rate; any single error resets it', async () => {
  const db = openDatabase(':memory:');
  try {
    for (let id = 1; id <= 8; id++) upsertSubject(db, { id, type: 2, name: 'recover' + id });
    let clock = Date.now(),
      calls = 0,
      errorAt = 0;
    const rates = [];
    const result = await fillPosterAddresses(db, {
      signal: new AbortController().signal,
      userAgent: 'test',
      concurrency: 1,
      intervalMs: 40,
      now: () => clock,
      wait: async (ms) => {
        clock += ms;
      },
      // Virtual clock covers retry waits and exact healthy-window boundaries.
      fetchImpl: async () => {
        calls++;
        if (calls === 1) clock += 9000;
        if (calls === 2) {
          errorAt = clock;
          throw new Error('one transient failure');
        }
        if (calls === 3) clock = errorAt + 9000;
        if (calls === 4) clock = errorAt + 9999;
        if (calls === 5) clock = errorAt + 10000;
        if (calls === 6) clock = errorAt + 19999;
        if (calls === 7) clock = errorAt + 20000;
        if (calls >= 8) clock += 20000;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://lain.bgm.tv/test.jpg' },
        });
      },
      onProgress: (p) => rates.push({ processed: p.processed, rate: p.targetRate }),
    });
    assert.equal(result.networkErrors, 1);
    assert.equal(result.recoveries, 2);
    assert.equal(result.targetRate, 100);
    assert.deepEqual([...new Set(rates.map((r) => r.rate))], [25, 50, 100]);
    assert.equal(rates.find((r) => r.processed === 3).rate, 25);
    assert.equal(rates.find((r) => r.processed === 4).rate, 50);
    assert.equal(rates.find((r) => r.processed === 5).rate, 50);
  } finally {
    db.close();
  }
});

test('three workers share rate gate without duplicate assignments and persist all results', async () => {
  const db = openDatabase(':memory:');
  try {
    for (let id = 1; id <= 6; id++) upsertSubject(db, { id, type: 2, name: 'parallel' + id });
    let active = 0,
      maximum = 0;
    const starts = [],
      ids = [];
    const result = await fillPosterAddresses(db, {
      signal: new AbortController().signal,
      userAgent: 'test',
      intervalMs: 35,
      concurrency: 3,
      fetchImpl: async (url) => {
        starts.push(performance.now());
        ids.push(url);
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 150));
        active--;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://lain.bgm.tv/pic/cover/c/test.jpg' },
        });
      },
    });
    assert.equal(maximum, 3);
    assert.equal(new Set(ids).size, 6);
    assert.equal(result.saved, 6);
    for (let i = 1; i < starts.length; i++)
      assert.ok(starts[i] - starts[i - 1] >= 30, 'global start spacing retained');
  } finally {
    db.close();
  }
});

test('server cooldown delays later jobs and reduces the shared request frequency', async () => {
  const db = openDatabase(':memory:');
  try {
    for (let id = 1; id <= 2; id++) upsertSubject(db, { id, type: 2, name: 'limited' + id });
    let clock = Date.now(),
      calls = 0;
    const starts = [];
    const result = await fillPosterAddresses(db, {
      signal: new AbortController().signal,
      userAgent: 'test',
      concurrency: 1,
      intervalMs: 500,
      now: () => clock,
      wait: async (ms) => {
        clock += ms;
      },
      fetchImpl: async () => {
        starts.push(clock);
        calls++;
        return calls === 1
          ? new Response(null, { status: 429, headers: { 'retry-after': '60' } })
          : new Response(null, {
              status: 302,
              headers: { location: 'https://lain.bgm.tv/pic/cover/c/test.jpg' },
            });
      },
    });
    assert.equal(result.saved, 2);
    assert.equal(result.intervalMs, 1000);
    assert.ok(starts[1] - starts[0] >= 60000);
    assert.ok(starts[2] - starts[1] >= 1000);
  } finally {
    db.close();
  }
});

test('one hundred concurrent requests are supported and limit windows halve 100,50,25', async () => {
  const db = openDatabase(':memory:');
  try {
    for (let id = 1; id <= 100; id++) upsertSubject(db, { id, type: 2, name: 'fast' + id });
    let active = 0,
      maximum = 0;
    const pending = [];
    await fillPosterAddresses(db, {
      signal: new AbortController().signal,
      userAgent: 'test',
      intervalMs: 1,
      fetchImpl: async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => {
          pending.push(resolve);
          if (pending.length === 100) for (const release of pending) release();
        });
        active--;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://lain.bgm.tv/test.jpg' },
        });
      },
    });
    assert.equal(maximum, 100);
    upsertSubject(db, { id: 101, type: 2, name: 'limited' });
    let clock = Date.now(),
      calls = 0;
    const rates = [];
    const result = await fillPosterAddresses(db, {
      signal: new AbortController().signal,
      userAgent: 'test',
      now: () => clock,
      wait: async (ms) => {
        clock += ms;
      },
      onProgress: (p) => rates.push(p.targetRate),
      fetchImpl: async () =>
        ++calls <= 2
          ? new Response(null, { status: 429, headers: { 'retry-after': '60' } })
          : new Response(null, {
              status: 302,
              headers: { location: 'https://lain.bgm.tv/test.jpg' },
            }),
    });
    assert.equal(result.saved, 1);
    assert.equal(result.rateLimits, 2);
    assert.equal(result.targetRate, 25);
    assert.deepEqual([...new Set(rates)], [100, 50, 25]);
  } finally {
    db.close();
  }
});

test('address-only worker persists redirects, records no poster, and resumes without repeated requests', async () => {
  const db = openDatabase(':memory:');
  try {
    for (const id of [1, 2, 3])
      upsertSubject(db, {
        id,
        type: 2,
        name: 'test' + id,
        images: id === 3 ? { common: 'https://lain.bgm.tv/existing.jpg' } : undefined,
      });
    const urls = [];
    const fetchImpl = async (url, options) => {
      urls.push(url);
      assert.equal(options.redirect, 'manual');
      return new Response(null, {
        status: 302,
        headers: {
          location: url.includes('/1/')
            ? 'https://lain.bgm.tv/pic/cover/c/1.jpg'
            : 'https://lain.bgm.tv/img/no_icon_subject.png',
        },
      });
    };
    const options = {
      signal: new AbortController().signal,
      userAgent: 'test',
      fetchImpl,
      intervalMs: 0,
      wait: async () => {},
    };
    const first = await fillPosterAddresses(db, options);
    assert.equal(first.saved, 1);
    assert.equal(first.missing, 1);
    assert.equal(urls.length, 2);
    assert.ok(urls.every((url) => url.startsWith('https://api.bgm.tv/')));
    assert.equal(
      db.prepare('SELECT image_url FROM subjects WHERE bangumi_id=1').get().image_url,
      'https://lain.bgm.tv/pic/cover/c/1.jpg',
    );
    assert.equal((await fillPosterAddresses(db, options)).total, 0);
    assert.equal(urls.length, 2);
  } finally {
    db.close();
  }
});
test('network failure retries finitely and stopping does not mark an unfinished item', async () => {
  const db = openDatabase(':memory:');
  try {
    upsertSubject(db, { id: 1, type: 2, name: 'test' });
    let calls = 0;
    const options = {
      signal: new AbortController().signal,
      userAgent: 'test',
      intervalMs: 0,
      wait: async () => {},
      fetchImpl: async () => {
        calls++;
        throw new Error('offline');
      },
    };
    const result = await fillPosterAddresses(db, options);
    assert.equal(calls, 3);
    assert.equal(result.failed, 1);
    assert.equal((await fillPosterAddresses(db, options)).total, 0);
    const controller = new AbortController();
    controller.abort();
    db.exec('DELETE FROM poster_sources');
    const stopped = await fillPosterAddresses(db, { ...options, signal: controller.signal });
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.processed, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM poster_sources').get().n, 0);
  } finally {
    db.close();
  }
});
test('address discovery respects rate limiting and rejects external redirects', async () => {
  const options = { signal: new AbortController().signal, userAgent: 'test' };
  const limited = await discoverPosterAddress(1, {
    ...options,
    fetchImpl: async () => new Response(null, { status: 429, headers: { 'retry-after': '120' } }),
  });
  assert.equal(limited.waitMs, 120000);
  await assert.rejects(
    discoverPosterAddress(1, {
      ...options,
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: 'https://example.com/image.jpg' } }),
    }),
  );
});
