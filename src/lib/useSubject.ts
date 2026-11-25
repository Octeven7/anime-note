import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Subject } from '../types';

const cache = new Map<string, Subject>();
export function useSubject(id: string) {
  const [subject, setSubject] = useState<Subject | null>(() => cache.get(id) || null);
  const [loading, setLoading] = useState(!cache.has(id));
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [nonce, setNonce] = useState(0);
  const latest = useRef(subject);
  useEffect(() => {
    if (!subject?.rating_refresh_pending) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<Subject>(`/api/catalog/${id}`, { signal: controller.signal })
        .then((s) => {
          if (controller.signal.aborted) return;
          cache.set(id, s);
          latest.current = s;
          setSubject(s);
        })
        .catch(() => {});
    }, 5000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, subject]);
  useEffect(() => {
    const controller = new AbortController();
    const remember = (s: Subject) => {
      cache.set(id, s);
      latest.current = s;
      if (cache.size > 100) cache.delete(cache.keys().next().value!);
      setSubject(s);
      setLoading(false);
    };
    setError('');
    setWarning('');
    void (async () => {
      try {
        const local = await api<Subject>(`/api/catalog/${id}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        remember(local);
        if (
          local.restricted ||
          (local.source?.detailComplete &&
            Date.now() - Date.parse(local.source.fetchedAt) < 86400000)
        )
          return;
        setHydrating(true);
        try {
          const result = await api<{ item: Subject; warning?: string }>(
            `/api/integrations/bangumi/subjects/${local.bangumi_id}`,
            {
              method: 'POST',
              body: {},
              signal: controller.signal,
            },
          );
          if (!controller.signal.aborted) {
            remember(result.item);
            setWarning(result.warning || '');
          }
        } catch {
          if (!controller.signal.aborted)
            setWarning('本地资料已展示，关联资料暂未更新，可以稍后刷新。');
        } finally {
          if (!controller.signal.aborted) setHydrating(false);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          if (!latest.current) setError((e as Error).message);
          else setWarning('暂时无法连接服务，正在展示已载入资料。');
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [id, nonce]);
  return {
    data: subject ? { subject, warning } : null,
    loading,
    error,
    hydrating,
    reload: () => setNonce((n) => n + 1),
  };
}
