export interface PosterMetric {
  id: number;
  state: string;
  totalMs: number;
  decodeMs?: number;
  browser?: {
    beforeRequestMs: number;
    dnsMs: number;
    connectMs: number;
    responseWaitMs: number;
    transferMs: number;
    transferBytes: number;
    bodyBytes: number;
  };
  protocol?: string;
  serverTiming?: string;
  retries: number;
}
export const posterMetrics: PosterMetric[] = [];
let retryActive = 0;
const retryWaiters: Array<() => void> = [];
async function retrySlot() {
  if (retryActive >= 2) await new Promise<void>((r) => retryWaiters.push(r));
  else retryActive++;
  return () => {
    const next = retryWaiters.shift();
    if (next) next();
    else retryActive--;
  };
}
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
export async function fetchPoster(
  url: string,
  signal: AbortSignal,
  onWait: (until: number) => void,
) {
  const start = performance.now();
  let lastStatus = 'network_error',
    serverTiming = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    let release: (() => void) | undefined;
    try {
      if (attempt) release = await retrySlot();
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      });
      serverTiming = response.headers.get('Server-Timing') || '';
      if (response.ok) {
        const blob = await response.blob();
        return { blob, retries: attempt, serverTiming, totalMs: performance.now() - start };
      }
      lastStatus =
        response.status === 404 ? 'none' : response.status === 403 ? 'forbidden' : 'temporary';
      if (response.status !== 429 && response.status < 500) {
        await response.body?.cancel();
        return {
          error: lastStatus,
          retries: attempt,
          serverTiming,
          totalMs: performance.now() - start,
        };
      }
      const value = response.headers.get('Retry-After');
      const delay = value
        ? Number.isFinite(Number(value))
          ? Number(value) * 1000
          : Math.max(0, Date.parse(value) - Date.now())
        : 1000 * 2 ** attempt;
      await response.body?.cancel();
      if (attempt === 2) break;
      release?.();
      release = undefined;
      const wait = Math.max(1000, Number.isFinite(delay) ? delay : 5000) + Math.random() * 750;
      onWait(Date.now() + wait);
      await pause(wait, signal);
    } catch (e) {
      if (signal.aborted) throw e;
      if (attempt === 2) break;
      release?.();
      release = undefined;
      const wait = 1000 * 2 ** attempt + Math.random() * 750;
      onWait(Date.now() + wait);
      await pause(wait, signal);
    } finally {
      release?.();
    }
  }
  return { error: lastStatus, retries: 2, serverTiming, totalMs: performance.now() - start };
}
export function recordPosterMetric(metric: PosterMetric) {
  posterMetrics.push(metric);
  if (posterMetrics.length > 1000) posterMetrics.shift();
}
