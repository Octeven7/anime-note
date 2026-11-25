import { it, expect, vi, afterEach } from 'vitest';
import { fetchPoster } from './posterClient';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('临时失败按Retry-After自动重试原URL，无图不重试', async () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return calls.length === 1
        ? new Response(null, { status: 503, headers: { 'Retry-After': '5' } })
        : new Response('image');
    }),
  );
  let until = 0;
  const result = fetchPoster('/api/posters/1', new AbortController().signal, (n) => (until = n));
  await vi.advanceTimersByTimeAsync(4000);
  expect(calls).toHaveLength(1);
  expect(until).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(2000);
  expect((await result).retries).toBe(1);
  expect(calls).toEqual(['/api/posters/1', '/api/posters/1']);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 404 })),
  );
  expect((await fetchPoster('/api/posters/2', new AbortController().signal, () => {})).error).toBe(
    'none',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('切页取消重试等待，不再发出后续请求', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 502, headers: { 'Retry-After': '5' } })),
  );
  const controller = new AbortController();
  const task = fetchPoster('/api/posters/1', controller.signal, () => {});
  const assertion = expect(task).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(10);
  controller.abort();
  await assertion;
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(1);
});
