import { useCallback, useEffect, useRef, useState } from 'react';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: options.signal || AbortSignal.timeout(90000),
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new ApiError(0, '无法连接服务，请确认 start.cmd 正在运行；未保存草稿会留在此浏览器。');
  }
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json'))
    throw new ApiError(response.status, '服务响应异常，请确认前后端均已启动。');
  const value = await response.json();
  if (!response.ok) throw new ApiError(response.status, value.error || '请求失败');
  return value as T;
}
export function useRemote<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>) {
  const latest = useRef(fetcher);
  latest.current = fetcher;
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string }>({
    data: null,
    loading: true,
    error: '',
  });
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState((previous) => ({ ...previous, loading: true, error: '' }));
    latest
      .current(controller.signal)
      .then((data) => {
        if (active) setState({ data, loading: false, error: '' });
      })
      .catch((e) => {
        if (active) setState({ data: null, loading: false, error: e.message });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [key, nonce]);
  return { ...state, reload };
}
export function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], {
      type:
        typeof value === 'string'
          ? 'text/markdown;charset=utf-8'
          : 'application/json;charset=utf-8',
    }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('zh-CN') : '尚未提供';
}
