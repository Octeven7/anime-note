import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BangumiClient, UpstreamError } from './bangumi.mjs';
test('Bangumi章节分页读取全部类型，携带服务端UA且不泄露token到结果', async () => {
  const paths = [];
  const client = new BangumiClient({
    intervalMs: 0,
    userAgent: 'test-user/paper-screen/0.1.0',
    token: 'test-secret',
    fetchImpl: async (url, options) => {
      paths.push(url);
      assert.equal(options.headers.Authorization, 'Bearer test-secret');
      assert.equal(options.headers['User-Agent'], 'test-user/paper-screen/0.1.0');
      let data;
      if (url.includes('/episodes'))
        data = url.includes('offset=0')
          ? { total: 2, data: [{ id: 1 }] }
          : { total: 2, data: [{ id: 2 }] };
      else if (url.endsWith('/characters') || url.endsWith('/persons')) data = [];
      else data = { id: 1, type: 2 };
      return new Response(JSON.stringify(data));
    },
  });
  const bundle = await client.subjectBundle(1);
  assert.equal(bundle.episodes.length, 2);
  assert.equal(paths.length, 5);
  assert.ok(!JSON.stringify(bundle).includes('secret'));
});
test('上游异常、无权限及R18给出可控错误', async () => {
  const client = new BangumiClient({
    intervalMs: 0,
    fetchImpl: async () => new Response('{}', { status: 429 }),
  });
  await assert.rejects(
    client.subjectBundle(1),
    (e) => e instanceof UpstreamError && e.upstreamStatus === 429,
  );
  const restricted = new BangumiClient({
    intervalMs: 0,
    fetchImpl: async () => new Response(JSON.stringify({ id: 1, type: 2, nsfw: true })),
  });
  await assert.rejects(restricted.subjectBundle(1), /R18/);
});
