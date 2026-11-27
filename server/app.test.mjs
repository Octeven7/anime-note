import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase } from './database.mjs';
import { createApp } from './app.mjs';
import { storeBundle } from './catalog.mjs';
import { UpstreamError } from './bangumi.mjs';
test('HTTP搜索、缓存、上游失败回退及写入来源校验', async () => {
  const db = openDatabase(':memory:');
  let calls = 0;
  let backgroundCalls = 0;
  const bundle = {
    subject: {
      id: 1,
      type: 2,
      name: '真实来源测试',
      name_cn: '测试动画',
      date: '2023-01-01',
      tags: [{ name: '奇幻' }],
      rating: { score: 8, total: 100 },
    },
    episodes: [],
    characters: [],
    persons: [],
  };
  const server = createApp({
    db,
    client: {
      request: async () => {
        backgroundCalls++;
      },
      searchTag: async () => {
        backgroundCalls++;
      },
      subjectBundle: async () => {
        calls++;
        if (calls > 1) throw new UpstreamError('断网');
        return bundle;
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body = {}, headers = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await (await fetch(base + '/api/health')).json()).catalogCount, 0);
    assert.equal((await fetch(base + '/api/catalog?quarter=9')).status, 400);
    const result = await (await post('/api/integrations/bangumi/subjects/1')).json();
    assert.equal(result.cached, false);
    assert.equal(result.item.name_cn, '测试动画');
    assert.equal((await (await post('/api/integrations/bangumi/subjects/1')).json()).cached, true);
    assert.equal(calls, 1);
    assert.equal(
      (await (await post('/api/integrations/bangumi/subjects/1', { refresh: true })).json()).stale,
      true,
    );
    assert.equal((await (await fetch(base + '/api/catalog?q=测试')).json()).total, 1);
    assert.equal((await fetch(base + `/api/catalog/${result.item.id}`)).status, 200);
    assert.equal(
      (await (await fetch(base + '/api/catalog?tag=%E5%A5%87%E5%B9%BB')).json()).total,
      1,
    );
    assert.equal(backgroundCalls, 0);
    assert.equal(
      (await post('/api/integrations/bangumi/subjects/1', {}, { Origin: 'https://evil.example' }))
        .status,
      403,
    );
    assert.equal(
      (await post('/api/integrations/bangumi/subjects/1', { refresh: 'yes' })).status,
      400,
    );
    assert.equal((await post('/api/integrations/bangumi/subjects/999')).status, 502);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    db.close();
  }
});
