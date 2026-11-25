import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase } from './database.mjs';
import { upsertSubject } from './catalog.mjs';
import { posterService } from './posters.mjs';
import { createApp } from './app.mjs';
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
const image = () => new Response(pixel, { headers: { 'content-type': 'image/png' } });
function seed(db, id = 1, url = true) {
  upsertSubject(db, {
    id,
    type: 2,
    name: '作品' + id,
    images: url ? { common: `https://lain.bgm.tv/pic/cover/l/${id}.jpg` } : undefined,
  });
}
test('预取失败不阻断前台，地址持久化，无图负缓存跨服务复用', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  let calls = 0;
  const p = posterService(db, {
    cacheDir: null,
    fetchImpl: async () => (++calls === 1 ? new Response(null, { status: 500 }) : image()),
  });
  try {
    await assert.rejects(p(1, { priority: false }));
    assert.equal((await p(1)).cache, 'MISS');
    assert.equal(calls, 2);
    seed(db, 2, false);
    let resolves = 0;
    const opts = {
      cacheDir: null,
      fetchImpl: async (url) => {
        if (url.includes('api.bgm.tv')) {
          resolves++;
          return new Response(null, {
            status: 302,
            headers: { location: 'https://lain.bgm.tv/pic/cover/l/2.jpg' },
          });
        }
        return image();
      },
    };
    const a = posterService(db, opts);
    await a(2);
    a.close();
    const b = posterService(db, opts);
    await b(2);
    b.close();
    assert.equal(resolves, 1);
    assert.ok(db.prepare('SELECT image_url FROM subjects WHERE bangumi_id=2').get().image_url);
    seed(db, 3, false);
    let missingCalls = 0;
    const c = posterService(db, {
      cacheDir: null,
      fetchImpl: async () => {
        missingCalls++;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://lain.bgm.tv/img/no_icon_subject.png' },
        });
      },
    });
    await assert.rejects(c(3), (e) => e.status === 404);
    await assert.rejects(c(3), (e) => e.status === 404);
    assert.equal(missingCalls, 1);
    c.close();
  } finally {
    p.close();
    db.close();
  }
});
test('共享下载仅在最后一个需求方离开后取消，排队取消不发起上游请求', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  seed(db, 2);
  let finish,
    calls = 0;
  const p = posterService(db, {
    cacheDir: null,
    concurrency: 1,
    fetchImpl: async (url, { signal }) => {
      calls++;
      return new Promise((resolve, reject) => {
        finish = () => resolve(image());
        signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')), {
          once: true,
        });
      });
    },
  });
  try {
    const a = new AbortController(),
      b = new AbortController();
    const first = p(1, { signal: a.signal }),
      second = p(1, { signal: b.signal });
    a.abort();
    await assert.rejects(first);
    assert.equal(calls, 1);
    const c = new AbortController();
    const queued = p(2, { signal: c.signal });
    c.abort();
    await assert.rejects(queued);
    finish();
    await second;
    assert.equal(calls, 1);
    assert.equal(p.diagnostics().queued, 0);
  } finally {
    p.close();
    db.close();
  }
});
test('HTTP错误不缓存、带重试时间；成功返回分段计时；状态诊断不泄露上游地址', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  const app = createApp({
    db,
    client: {},
    posterOptions: { cacheDir: null, fetchImpl: async () => new Response(null, { status: 500 }) },
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  try {
    const base = `http://127.0.0.1:${app.address().port}`;
    const r = await fetch(base + '/api/posters/1');
    assert.equal(r.status, 502);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('retry-after'), '5');
    assert.ok(r.headers.get('server-timing').includes('poster_queue'));
    const d = await (await fetch(base + '/api/posters/diagnostics')).json();
    assert.equal(d.records[0].status, 'upstream_failed');
    assert.ok(!JSON.stringify(d).includes('lain.bgm.tv'));
  } finally {
    app.closeAllConnections();
    await new Promise((r) => app.close(r));
    db.close();
  }
});
test('失效图片地址最多重解析一次，上游限流尊重Retry-After', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  let calls = 0;
  const p = posterService(db, {
    cacheDir: null,
    fetchImpl: async (url) => {
      calls++;
      if (url.includes('api.bgm.tv'))
        return new Response(null, {
          status: 302,
          headers: { location: 'https://lain.bgm.tv/new.jpg' },
        });
      return url.includes('new.jpg') ? image() : new Response(null, { status: 404 });
    },
  });
  try {
    await p(1);
    assert.equal(calls, 3);
    assert.equal(
      db.prepare('SELECT image_url FROM subjects').get().image_url,
      'https://lain.bgm.tv/new.jpg',
    );
    const q = posterService(db, {
      cacheDir: null,
      fetchImpl: async () => new Response(null, { status: 429, headers: { 'retry-after': '9' } }),
    });
    await assert.rejects(q(1), (e) => e.status === 503 && e.retryAfter === 9);
    q.close();
  } finally {
    p.close();
    db.close();
  }
});
