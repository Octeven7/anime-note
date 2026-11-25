import { useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { api, useRemote } from '../lib/api';
import type { Ratings } from '../types';

export function StarRating({
  value,
  disabled,
  onChange,
}: {
  value: number | null;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div
      className="star-rating"
      role="group"
      aria-label="我的整体评分"
      onMouseLeave={() => setHover(null)}
    >
      {Array.from({ length: 10 }, (_, i) => i + 1).map((score) => (
        <button
          key={score}
          type="button"
          aria-label={`评为 ${score} 分`}
          aria-pressed={value === score}
          disabled={disabled}
          onMouseEnter={() => setHover(score)}
          onFocus={() => setHover(score)}
          onBlur={() => setHover(null)}
          onClick={() => onChange(score)}
          className={(hover ?? value ?? 0) >= score ? 'lit' : ''}
        >
          <Star
            size={22}
            fill={(hover ?? value ?? 0) >= score ? 'currentColor' : 'none'}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  );
}

export function SubjectRating({
  subjectId,
  revision,
  onChanged,
  onRated,
  onBusyChange,
}: {
  subjectId: string;
  revision: number;
  onChanged: () => void;
  onRated?: (score: number) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const state = useRemote<Ratings>(`${subjectId}:${revision}`, (signal) =>
    api(`/api/me/subjects/${subjectId}/ratings`, { signal }),
  );
  const [saved, setSaved] = useState<Ratings | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const score =
    (saved && (!state.data?.current || saved.current!.rated_at >= state.data.current.rated_at)
      ? saved
      : state.data
    )?.current?.score ?? null;
  async function rate(value: number) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      const result = await api<Ratings>(`/api/me/subjects/${subjectId}/ratings`, {
        method: 'POST',
        body: { score: value },
      });
      setSaved(result);
      onRated?.(value);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <section className="my-rating">
      <div className="flex items-baseline justify-between gap-2">
        <strong>我的评分</strong>
        <span className="font-mono">{score ?? '—'} / 10</span>
      </div>
      <StarRating
        value={score}
        disabled={busy || (state.loading && !state.data && !saved)}
        onChange={(value) => void rate(value)}
      />
      <p className="text-xs text-muted" role="status">
        {busy ? '正在保存分数…' : '点击第几颗星即打几分，独立于文字总评。'}
      </p>
      {(error || state.error) && (
        <p role="alert" className="error text-sm">
          {error || state.error}
        </p>
      )}
    </section>
  );
}
