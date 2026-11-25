import { useEffect, useState } from 'react';
import { Search, SlidersHorizontal, ChevronUp, ChevronDown } from 'lucide-react';
import { api, useRemote } from './lib/api';
import type { Page, Subject } from './types';
import { Button } from './components/ui/button';
import { Poster, Empty, ErrorNotice, Skeleton, LoadingIndicator } from './components/common';
import { stepYear, scoreRangeError } from './lib/catalogFilters';
export function SubjectGrid({ items }: { items: Subject[] }) {
  return (
    <div className="catalog-grid">
      {items.map((s, index) => (
        <a className="catalog-card" href={`#/subject/${s.id}`} key={s.id}>
          <Poster
            url={s.image_url}
            bangumiId={s.bangumi_id}
            title={s.name_cn || s.name}
            priority={index < 5}
          />
          <div className="catalog-card-meta">
            <span>{s.air_date?.slice(0, 4) || '年份待定'}</span>
            <span>
              {s.score === null || s.score === 0 ? (
                '暂无评分'
              ) : (
                <>
                  <strong>{s.score.toFixed(1)}</strong>{' '}
                  <small>
                    {s.rating_count === null ? '' : `${s.rating_count.toLocaleString()} 人`}
                  </small>
                </>
              )}
            </span>
          </div>
          <h2 className="line-clamp-2" title={s.name_cn || s.name}>
            {s.name_cn || s.name}
          </h2>
          {s.status && (
            <p className="text-sm text-muted">
              {
                (
                  {
                    wish: '想看',
                    doing: '在看',
                    done: '看完',
                    hold: '搁置',
                    dropped: '弃番',
                  } as Record<string, string>
                )[s.status]
              }{' '}
              {(s.status === 'doing' || s.status === 'hold') && ` · 已看 ${s.watched || 0} 集`}
              {s.myScore !== null && s.myScore !== undefined ? ` · 我的评分 ${s.myScore}` : ''}
            </p>
          )}
          <p className="catalog-original line-clamp-1">{s.name_cn ? s.name : ' '}</p>
        </a>
      ))}
    </div>
  );
}
export default function Catalog({
  query,
  navigate,
}: {
  query: string;
  navigate: (url: string) => void;
}) {
  const p = new URLSearchParams(query);
  const [q, setQ] = useState(p.get('q') || ''),
    [year, setYear] = useState(p.get('year') || ''),
    [quarter, setQuarter] = useState(p.get('quarter') || ''),
    [score, setScore] = useState(p.get('minScore') || ''),
    [maxScore, setMaxScore] = useState(p.get('maxScore') || ''),
    [filterError, setFilterError] = useState(''),
    [votes, setVotes] = useState(p.get('minVotes') ?? ''),
    [tag, setTag] = useState(p.getAll('tag').join('，')),
    [sort, setSort] = useState(p.get('sort') || 'score');
  const effective = new URLSearchParams(query);
  if (!effective.has('minVotes')) effective.set('minVotes', '100');
  effective.set('limit', '25');
  const result = useRemote<Page<Subject>>(effective.toString(), (signal) =>
    api(`/api/catalog?${effective}`, { signal }),
  );
  const page = result.data?.page || Number(p.get('page') || 1);
  useEffect(() => {
    if (!result.data?.tagSync?.pending && !result.data?.ratingSync?.pending) return;
    const timer = setTimeout(result.reload, result.data?.tagSync?.pending ? 2000 : 5000);
    return () => clearTimeout(timer);
  }, [result.data, result.reload]);
  const apply = () => {
    const error = scoreRangeError(score, maxScore);
    setFilterError(error);
    if (error) return;
    const next = new URLSearchParams();
    if (q.trim()) next.set('q', q.trim());
    if (year) next.set('year', year);
    if (year && quarter) next.set('quarter', quarter);
    if (score) next.set('minScore', score);
    if (maxScore) next.set('maxScore', maxScore);
    next.set('minVotes', votes || '100');
    for (const t of tag
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean))
      next.append('tag', t);
    next.set('sort', sort);
    navigate(`/catalog?${next}`);
  };
  const turn = (n: number) => {
    const next = new URLSearchParams(query);
    next.set('page', String(n));
    navigate(`/catalog?${next}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return (
    <section>
      <div className="page-heading">
        <p className="eyebrow text-brand">THE ANIME INDEX</p>
        <h1>下一段故事，从这里开始。</h1>
        <p>翻一翻资料库，找到值得留在手账里的作品。</p>
      </div>
      <form
        className="catalog-search"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label className="search-box">
          <Search size={19} />
          <input
            aria-label="搜索番剧"
            placeholder="中文名、原名或别名……"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <Button type="submit">搜索番剧</Button>
      </form>
      <details className="filters">
        <summary>
          <SlidersHorizontal size={15} />
          筛选与排序
        </summary>
        <div className="filter-fields">
          <label>
            首播年份
            <span className="year-stepper">
              <input
                aria-label="首播年份"
                type="number"
                min="1900"
                max="2200"
                placeholder="全部年份"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    setYear(stepYear(year, event.key === 'ArrowUp' ? 1 : -1));
                  }
                }}
              />
              <span className="year-stepper-buttons">
                <button
                  type="button"
                  aria-label="增加首播年份"
                  onClick={() => setYear(stepYear(year, 1))}
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  type="button"
                  aria-label="减少首播年份"
                  onClick={() => setYear(stepYear(year, -1))}
                >
                  <ChevronDown size={13} />
                </button>
              </span>
            </span>
          </label>
          <label>
            季度
            <select
              aria-label="季度"
              value={quarter}
              onChange={(e) => setQuarter(e.target.value)}
              disabled={!year}
            >
              <option value="">全年</option>
              {['冬 · 1—3 月', '春 · 4—6 月', '夏 · 7—9 月', '秋 · 10—12 月'].map((s, i) => (
                <option value={i + 1} key={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="score-range-field">
            <legend>评分范围（含两端）</legend>
            <div className="score-range-inputs">
              <input
                aria-label="最低评分"
                type="number"
                inputMode="decimal"
                min="0"
                max="10"
                step="0.1"
                placeholder="最低分"
                value={score}
                onChange={(event) => {
                  setScore(event.target.value);
                  setFilterError('');
                }}
              />
              <span aria-hidden="true">—</span>
              <input
                aria-label="最高评分"
                type="number"
                inputMode="decimal"
                min="0"
                max="10"
                step="0.1"
                placeholder="最高分"
                value={maxScore}
                onChange={(event) => {
                  setMaxScore(event.target.value);
                  setFilterError('');
                }}
              />
            </div>
          </fieldset>
          <label>
            至少评分人数
            <input
              aria-label="至少评分人数"
              placeholder="默认100人"
              type="number"
              min="0"
              max="1000000000"
              value={votes}
              onChange={(e) => setVotes(e.target.value)}
            />
          </label>
          <label className="tag-field">
            标签（同时满足）
            <input
              aria-label="标签"
              placeholder="奇幻，冒险"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            />
          </label>
          <label>
            排序
            <select aria-label="排序" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="score">社区评分（精确均分）</option>
              <option value="votes">评分人数</option>
              <option value="date">首播时间</option>
              <option value="name">名称</option>
            </select>
          </label>
        </div>
        {filterError && (
          <p role="alert" className="error text-sm mt-3">
            {filterError}
          </p>
        )}
        <div className="flex gap-2 mt-3">
          <Button variant="outline" onClick={apply}>
            应用筛选
          </Button>
          <Button variant="ghost" onClick={() => navigate('/catalog')}>
            清除筛选
          </Button>
        </div>
      </details>
      <div className="results-heading">
        <span>
          {result.data ? `找到 ${result.data.total.toLocaleString()} 部动画` : '正在检索资料库……'}
        </span>
        <span>本地检索 · 资料来自 Bangumi</span>
      </div>
      {result.error ? (
        <ErrorNotice message={result.error} retry={result.reload} />
      ) : result.loading && !result.data ? (
        <Skeleton />
      ) : result.data?.items.length ? (
        <>
          <SubjectGrid items={result.data.items} />
          <div className="pagination">
            <Button variant="outline" disabled={page <= 1} onClick={() => turn(page - 1)}>
              上一页
            </Button>
            <span>
              第 {page} / {Math.max(1, Math.ceil(result.data.total / 25))} 页
            </span>
            <Button
              variant="outline"
              disabled={page * 25 >= result.data.total}
              onClick={() => turn(page + 1)}
            >
              下一页
            </Button>
          </div>
        </>
      ) : result.data?.tagSync?.pending ? null : (
        <Empty
          title="没有找到匹配的番剧"
          description="试试其他名称，或放宽年份、标签和评分限制。"
        />
      )}
      {(result.data?.tagSync?.pending || result.data?.ratingSync?.pending) && <LoadingIndicator />}
      <p className="footnote">
        季度按首播日期划分。标签检索会后台补全对应作品，详情在打开作品后按需补全；默认不展示 R18
        条目。
      </p>
    </section>
  );
}
