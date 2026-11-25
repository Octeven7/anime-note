import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase } from './database.mjs';
import { storeBundle } from './catalog.mjs';
import { createApp } from './app.mjs';
test('个人接口端到端：草稿、发布、冲突、软删除、进度、评分与备份预检', async () => {
  const db = openDatabase(':memory:');
  const sid = storeBundle(db, {
    subject: { id: 1, type: 2, name: '测试' },
    episodes: [{ id: 10, sort: 1, type: 0, name: '单集' }],
    characters: [],
    persons: [],
  });
  const app = createApp({ db, client: {} });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  const request = async (method, path, body) => {
    const response = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request('POST', '/api/me/notes', { userId: 'other' })).status, 400);
    let result = await request('POST', '/api/me/notes', {
      subjectId: sid,
      episodeId: 'bgm-episode-10',
      scope: 'episode',
      body: '中文记录 · 演出很好',
      isPublic: true,
      idempotencyKey: 'http-create',
    });
    assert.equal(result.status, 201);
    let note = result.body;
    assert.equal(
      (await request('POST', `/api/me/notes/${note.id}/publish`, { expectedVersion: note.version }))
        .status,
      400,
    );
    result = await request('POST', `/api/me/notes/${note.id}/publish`, {
      expectedVersion: note.version,
      spoiler: true,
    });
    assert.equal(result.status, 200);
    note = result.body;
    const hidden = (await request('GET', `/api/catalog/${sid}/impressions`)).body.items[0];
    assert.equal(hidden.hidden, true);
    assert.ok(!('body' in hidden));
    assert.equal(
      (await request('GET', `/api/catalog/${sid}/impressions?includeSpoilers=true`)).body.items[0]
        .body,
      '中文记录 · 演出很好',
    );
    assert.equal(
      (
        await request('PUT', `/api/me/notes/${note.id}/draft`, {
          expectedVersion: 1,
          body: '旧页面',
        })
      ).status,
      409,
    );
    result = await request('PUT', `/api/me/notes/${note.id}/draft`, {
      expectedVersion: note.version,
      body: '新的私密草稿',
    });
    note = result.body;
    assert.equal(
      (await request('GET', `/api/catalog/${sid}/impressions?includeSpoilers=true`)).body.items[0]
        .body,
      '中文记录 · 演出很好',
    );
    assert.equal((await request('GET', '/api/me/notes?q=私密')).body.total, 1);
    assert.equal((await request('GET', `/api/me/notes/${note.id}/history`)).body.items.length, 1);
    assert.equal(
      (await request('PUT', `/api/me/subjects/${sid}/collection`, { status: 'doing' })).body
        .collection.status,
      'doing',
    );
    assert.equal(
      (await request('PUT', `/api/me/subjects/${sid}/episodes/bgm-episode-10`, { watched: true }))
        .body.history.length,
      1,
    );
    assert.equal(
      (await request('POST', `/api/me/subjects/${sid}/ratings`, { score: 9 })).body.current.score,
      9,
    );
    const backup = await request('GET', '/api/me/backup');
    assert.equal(backup.body.format, 'paper-screen-personal');
    // Existing published note conflicts with a private restore: no automatic withdrawal or overwrite.
    assert.equal(
      (await request('POST', '/api/me/backup/restore', { backup: backup.body, dryRun: true }))
        .status,
      409,
    );
    result = await request('DELETE', `/api/me/notes/${note.id}`, { expectedVersion: note.version });
    assert.equal(result.status, 200);
    assert.equal((await request('GET', `/api/me/notes/${note.id}`)).status, 404);
    assert.equal(
      (await request('GET', '/api/me/trash')).body.items[0].version,
      result.body.version,
    );
    const restored = await request('POST', `/api/me/notes/${note.id}/restore`, {
      expectedVersion: result.body.version,
    });
    assert.equal(restored.body.draft.isPublic, false);
    assert.equal((await request('GET', `/api/catalog/${sid}/impressions`)).body.total, 0);
    const oversized = await fetch(base + '/api/me/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'a'.repeat(513 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    const malformed = await fetch(base + '/api/me/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    });
    assert.equal(malformed.status, 400);
  } finally {
    app.closeAllConnections();
    await new Promise((r) => app.close(r));
    db.close();
  }
});
