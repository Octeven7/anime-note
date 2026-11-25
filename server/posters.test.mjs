import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { openDatabase } from './database.mjs';
import { upsertSubject } from './catalog.mjs';
import { posterService } from './posters.mjs';
import { createApp } from './app.mjs';

const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
test('海报请求合并，缓存跨服务重启复用，HTTP支持浏览器缓存', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anime-poster-test-'));
  const db = openDatabase(':memory:');
  upsertSubject(db, { id: 1, type: 2, name: '海报测试' });
  let calls = 0;
  const options = {
    cacheDir: directory,
    fetchImpl: async (url) => {
      calls++;
      if (url.startsWith('https://api.bgm.tv/'))
        return new Response(null, {
          status: 302,
          headers: { location: 'https://lain.bgm.tv/pic/cover/l/test.jpg' },
        });
      assert.equal(url, 'https://lain.bgm.tv/r/400/pic/cover/l/test.jpg');
      return new Response(pixel, { headers: { 'content-type': 'image/png' } });
    },
  };
  const poster = posterService(db, options);
  let server;
  try {
    const results = await Promise.all(Array.from({ length: 12 }, () => poster(1)));
    assert.equal(calls, 2);
    assert.ok(results.every((image) => image.base64 === pixel.toString('base64')));
    assert.equal((await posterService(db, options)(1)).cache, 'HIT');
    assert.equal(calls, 2);
    server = createApp({ db, client: {}, posterOptions: options });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/posters/1`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-poster-cache'), 'HIT');
    assert.match(response.headers.get('cache-control'), /max-age=86400/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), pixel);
    assert.equal(
      (await fetch(url, { headers: { 'If-None-Match': response.headers.get('etag') } })).status,
      304,
    );
    assert.equal(calls, 2);
    assert.equal((await fetch(url.replace('/posters/1', '/posters/999'))).status, 404);
    const prefetch = await fetch(url.replace('/posters/1', '/posters/prefetch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1] }),
    });
    assert.equal(prefetch.status, 202);
    assert.equal(
      (
        await fetch(url.replace('/posters/1', '/posters/prefetch'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: Array(26).fill(1) }),
        })
      ).status,
      400,
    );
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('后台最多占两个槽位，当前页面无需等待后台释放，等待后台按FIFO执行', async () => {
  const db = openDatabase(':memory:');
  for (let id = 1; id <= 6; id++)
    upsertSubject(db, {
      id,
      type: 2,
      name: `作品${id}`,
      images: { common: `https://lain.bgm.tv/pic/cover/l/${id}.jpg` },
    });
  const started = [],
    release = new Map();
  const poster = posterService(db, {
    cacheDir: null,
    fetchImpl: async (url) => {
      const id = Number(url.match(/\/(\d+)\.jpg$/)[1]);
      started.push(id);
      await new Promise((resolve) => release.set(id, resolve));
      return new Response(pixel, { headers: { 'content-type': 'image/png' } });
    },
  });
  const pending = Array.from({ length: 6 }, (_, i) => poster(i + 1, { priority: false }));
  const visible = poster(6);
  try {
    assert.deepEqual(started, [1, 2, 6]);
    release.get(1)();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, [1, 2, 6, 3]);
  } finally {
    for (let pass = 0; pass < 6; pass++) {
      release.forEach((resolve) => resolve());
      await new Promise((resolve) => setImmediate(resolve));
    }
    await Promise.all([...pending, visible]);
    db.close();
  }
});

test('只请求固定API和Bangumi图片域名，R18与未知条目不取图', async () => {
  const db = openDatabase(':memory:');
  upsertSubject(db, { id: 1, type: 2, name: '测试' });
  upsertSubject(db, { id: 2, type: 2, name: '受限', nsfw: true });
  let calls = 0;
  const poster = posterService(db, {
    cacheDir: null,
    fetchImpl: async (url) => {
      calls++;
      assert.ok(url.startsWith('https://api.bgm.tv/'));
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    },
  });
  try {
    assert.equal(await poster(2), null);
    assert.equal(await poster(999), null);
    assert.equal(calls, 0);
    await assert.rejects(poster(1));
    await assert.rejects(poster(1));
    assert.equal(calls, 1);
  } finally {
    db.close();
  }
});
