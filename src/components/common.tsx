import { useEffect, useState, useRef } from 'react';
import { fetchPoster, recordPosterMetric } from '../lib/posterClient';
import { ImageOff, RefreshCw, BookOpen, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import { feelings, type Feeling } from '../types';
export function LoadingIndicator() {
  return (
    <div role="status" aria-label="正在加载" className="flex justify-center py-4 text-muted">
      <LoaderCircle
        className="animate-spin motion-reduce:animate-none"
        size={18}
        aria-hidden="true"
      />
    </div>
  );
}
export function Poster({
  url,
  bangumiId,
  title = '',
  className = '',
  priority = false,
}: {
  url?: string | null;
  bangumiId?: number;
  title?: string;
  className?: string;
  priority?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(priority),
    [image, setImage] = useState<string | null>(null),
    [state, setState] = useState('loading'),
    [attempt, setAttempt] = useState(0),
    [nextAt, setNextAt] = useState(0),
    [seconds, setSeconds] = useState(0);
  const src = bangumiId ? '/api/posters/' + bangumiId : url;
  useEffect(() => {
    if (priority) {
      setVisible(true);
      return;
    }
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [priority, src]);
  useEffect(() => {
    if (!nextAt) return;
    const update = () => setSeconds(Math.max(0, Math.ceil((nextAt - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [nextAt]);
  useEffect(() => {
    setImage(null);
    setState('loading');
    if (!src || !visible) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const started = performance.now();
    void fetchPoster(src, controller.signal, (until) => {
      if (!controller.signal.aborted) {
        setNextAt(until);
        setState('waiting');
      }
    })
      .then(async (result) => {
        if (controller.signal.aborted) return;
        setNextAt(0);
        if (!result.blob) {
          setState(result.error || 'temporary');
          recordPosterMetric({
            id: bangumiId || 0,
            state: result.error || 'temporary',
            totalMs: performance.now() - started,
            retries: result.retries,
            serverTiming: result.serverTiming,
          });
          return;
        }
        objectUrl = URL.createObjectURL(result.blob);
        const decoded = new Image();
        decoded.src = objectUrl;
        const decodeAt = performance.now();
        await decoded.decode();
        if (controller.signal.aborted) return;
        setImage(objectUrl);
        setState('ready');
        const resource = performance.getEntriesByName(new URL(src, location.href).href).at(-1) as
          PerformanceResourceTiming | undefined;
        // Includes connection setup and browser scheduling; it is not pure queue time.
        const browser = resource
          ? {
              beforeRequestMs: Math.max(0, resource.requestStart - resource.fetchStart),
              dnsMs: resource.domainLookupEnd - resource.domainLookupStart,
              connectMs: resource.connectEnd - resource.connectStart,
              responseWaitMs: resource.responseStart - resource.requestStart,
              transferMs: resource.responseEnd - resource.responseStart,
              transferBytes: resource.transferSize,
              bodyBytes: resource.encodedBodySize,
            }
          : undefined;
        if (ref.current) {
          ref.current.dataset.posterMs = String(Math.round(performance.now() - started));
          ref.current.dataset.posterProtocol = resource?.nextHopProtocol || 'unknown';
          ref.current.dataset.posterRetries = String(result.retries);
          ref.current.dataset.posterTiming = result.serverTiming;
          ref.current.dataset.posterBrowser = JSON.stringify(browser);
          ref.current.dataset.posterDecodeMs = String(performance.now() - decodeAt);
        }
        recordPosterMetric({
          id: bangumiId || 0,
          state: 'ready',
          totalMs: performance.now() - started,
          decodeMs: performance.now() - decodeAt,
          browser,
          protocol: resource?.nextHopProtocol,
          retries: result.retries,
          serverTiming: result.serverTiming,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setNextAt(0);
          setState('temporary');
        }
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, visible, attempt, bangumiId]);
  const failed = ['none', 'forbidden', 'temporary', 'network_error'].includes(state);
  return (
    <div
      ref={ref}
      className={`poster ${className} ${src && !image && !failed ? 'poster-loading' : ''}`}
      data-poster-state={state}
      data-poster-id={bangumiId}
    >
      {image ? (
        <img src={image} alt={title ? title + ' 海报' : '番剧海报'} decoding="async" />
      ) : !src || failed ? (
        <div className="poster-empty">
          <ImageOff size={28} />
          <span>{state === 'none' || !src ? '暂无海报' : '海报暂不可用'}</span>
          {src && state !== 'none' && state !== 'forbidden' && (
            <button
              className="text-xs underline"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setAttempt((n) => n + 1);
              }}
            >
              重试
            </button>
          )}
        </div>
      ) : state === 'waiting' ? (
        <span className="sr-only">{seconds}秒后重试</span>
      ) : null}
    </div>
  );
}

export function Feel({ value }: { value: Feeling | null | undefined }) {
  const index = feelings.findIndex((f) => f.value === value);
  return index >= 0 ? <span className={`feel feel-${index}`}>{feelings[index].label}</span> : null;
}
export function SectionTitle({ title, en }: { title: string; en: string }) {
  return (
    <div>
      <p className="eyebrow">{en}</p>
      <h2 className="section-title">{title}</h2>
    </div>
  );
}
export function Empty({
  title = '还没有记录',
  description,
  children,
}: {
  title?: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <BookOpen size={28} />
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="alert" role="alert">
      <p>{message}</p>
      {retry && (
        <Button variant="ghost" onClick={retry}>
          <RefreshCw size={15} />
          重试
        </Button>
      )}
    </div>
  );
}
export function Skeleton() {
  return (
    <div role="status" aria-label="正在加载" aria-busy="true" className="skeleton-layout">
      {[1, 2, 3, 4, 5].map((n) => (
        <div className={`skeleton ${n === 1 ? 'h-12 w-2/3' : 'h-16 w-full'}`} key={n} />
      ))}
    </div>
  );
}
