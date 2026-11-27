import { useEffect, useState } from 'react';
import { CalendarDays, Check, RefreshCw } from 'lucide-react';
import { api, useRemote, formatDate } from './lib/api';
import { slotInZone } from './lib/calendar';
import { Poster, Feel, Empty, ErrorNotice, Skeleton } from './components/common';
import { Button } from './components/ui/button';
import type { CalendarData, CalendarItem } from './types';
const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const scheduleTabs = [...days, '其他放送'];
const otherTab = days.length;
const releaseLabels = {
  movie: '剧场版',
  batch: '集中上线',
  batchPart: '分批上线',
  resumption: '分段复播',
};
export default function Schedule({
  revision,
  onChanged,
}: {
  revision: number;
  onChanged: () => void;
}) {
  const date = new Date();
  const [year, setYear] = useState(date.getFullYear()),
    [quarter, setQuarter] = useState(Math.floor(date.getMonth() / 3) + 1),
    [only, setOnly] = useState(false),
    [zone, setZone] = useState('Asia/Shanghai'),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const today = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(date),
  );
  const [selected, setSelected] = useState(today);
  useEffect(() => setSelected((previous) => (previous === otherTab ? previous : today)), [today]);
  const params = new URLSearchParams({
    year: String(year),
    quarter: String(quarter),
    following: String(only),
  });
  const remote = useRemote<CalendarData>(`${params}:${revision}`, (signal) =>
    api(`/api/calendar?${params}`, { signal }),
  );
  const slots =
    remote.data?.items.map((item) => ({ ...item, ...slotInZone(item.weekday, item.time, zone) })) ||
    [];
  const releasesBySubject = new Map<string, CalendarData['otherReleases']>();
  for (const release of remote.data?.otherReleases || []) {
    const releases = releasesBySubject.get(release.id);
    if (releases) releases.push(release);
    else releasesBySubject.set(release.id, [release]);
  }
  async function mark(item: CalendarItem) {
    if (!item.latestEpisode) return;
    setBusy(item.id);
    try {
      await api(`/api/me/subjects/${item.id}/episodes/${item.latestEpisode.id}`, {
        method: 'PUT',
        body: { watched: !item.watched },
      });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function refresh() {
    setBusy('refresh');
    setError('');
    try {
      await api(`/api/calendar?${params}&refresh=true`);
      remote.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="schedule">
      <div className="schedule-heading">
        <div>
          <p className="eyebrow text-brand">THE WEEKLY SCREENING</p>
          <h1 className="font-editorial text-4xl mt-3">这一周，故事继续。</h1>
          <p className="text-muted mt-3">给期待留一个位置，也给生活留一点空白。</p>
        </div>
        <CalendarDays size={38} strokeWidth={1} />
      </div>
      <div className="schedule-controls">
        <div className="season-picker">
          <label className="sr-only" htmlFor="schedule-year">
            放送年份
          </label>
          <select id="schedule-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => date.getFullYear() + 1 - i).map((y) => (
              <option value={y} key={y}>
                {y}
              </option>
            ))}
          </select>
          {['冬', '春', '夏', '秋'].map((s, i) => (
            <button
              aria-pressed={quarter === i + 1}
              className={quarter === i + 1 ? 'selected' : ''}
              key={s}
              onClick={() => setQuarter(i + 1)}
            >
              {s}
            </button>
          ))}
        </div>
        <label className="timezone">
          显示时区
          <select value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="Asia/Shanghai">北京时间 UTC+8</option>
            <option value="Asia/Tokyo">日本时间 UTC+9</option>
            <option value="America/Chicago">美国中部时间</option>
            <option value="UTC">协调世界时 UTC</option>
          </select>
        </label>
        <div className="filter-toggle" aria-label="番剧范围">
          <button
            className={!only ? 'selected' : ''}
            aria-pressed={!only}
            onClick={() => setOnly(false)}
          >
            全部
          </button>
          <button
            className={only ? 'selected' : ''}
            aria-pressed={only}
            onClick={() => setOnly(true)}
          >
            只看在追
          </button>
        </div>
        <Button variant="ghost" disabled={!!busy} onClick={() => void refresh()}>
          <RefreshCw size={14} />
          刷新
        </Button>
      </div>
      <p className="schedule-notice">
        {selected === otherTab
          ? '本季集中上线、分批上线、分段复播及上映的作品。'
          : `${remote.data?.notice || '正在读取放送资料……'} 未提供时刻的条目保留日本播出星期。`}
        {remote.data?.fetchedAt && ` 数据获取：${formatDate(remote.data.fetchedAt)}`}
      </p>
      {remote.data?.warning && <ErrorNotice message={remote.data.warning} />}
      {error && <ErrorNotice message={error} />}
      <div className="day-tabs" role="tablist" aria-label="选择放送分类">
        {scheduleTabs.map((d, i) => (
          <button
            role="tab"
            id={`weekday-${i}`}
            aria-selected={selected === i}
            aria-controls="schedule-day"
            className={selected === i ? 'selected' : ''}
            key={d}
            onClick={() => {
              setSelected(i);
            }}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (i + 1) % scheduleTabs.length
                  : event.key === 'ArrowLeft'
                    ? (i + scheduleTabs.length - 1) % scheduleTabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? scheduleTabs.length - 1
                        : null;
              if (next !== null) {
                event.preventDefault();
                setSelected(next);
                document.getElementById(`weekday-${next}`)?.focus();
              }
            }}
            tabIndex={selected === i ? 0 : -1}
          >
            {d}
            {i === today && <small>今天</small>}
          </button>
        ))}
      </div>
      {remote.error ? (
        <ErrorNotice message={remote.error} retry={remote.reload} />
      ) : remote.loading ? (
        <Skeleton />
      ) : selected === otherTab ? (
        <section
          id="schedule-day"
          role="tabpanel"
          aria-labelledby={`weekday-${otherTab}`}
          className={`schedule-day-layout season-${quarter}`}
        >
          {releasesBySubject.size ? (
            <div className="day-items">
              {[...releasesBySubject.values()].map((releases) => {
                const [item] = releases;
                const lastDate = releases[releases.length - 1].date;
                const kinds = [...new Set(releases.map(({ kind }) => releaseLabels[kind]))];
                return (
                  <article className="airing-card" key={item.id}>
                    <a href={`#/subject/${item.id}`} className="airing-poster">
                      <Poster url={item.image} bangumiId={item.bangumiId} title={item.title} />
                    </a>
                    <div className="airing-info">
                      <h3>
                        <a href={`#/subject/${item.id}`}>{item.title}</a>
                      </h3>
                      <p>
                        {kinds.join('、')}
                        {item.kind === 'batch' && item.episodes && ` · ${item.episodes} 话`}
                      </p>
                      <p>
                        <time dateTime={item.date}>{item.date}</time>
                        {lastDate !== item.date && (
                          <>
                            {' '}
                            至 <time dateTime={lastDate}>{lastDate}</time>
                          </>
                        )}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty title={only ? '本季暂无在追的其他放送' : '本季暂无其他放送'} />
          )}
        </section>
      ) : !slots.length ? (
        <Empty
          title={only ? '本季暂无正在追的番剧' : '本季暂无数据'}
          description={only ? '在作品详情中将收藏状态设为“在看”。' : '可以切换季度，或稍后刷新。'}
        />
      ) : (
        <div className={`schedule-day-layout season-${quarter}`}>
          {days.map(
            (day, i) =>
              i === selected && (
                <section
                  key={day}
                  id="schedule-day"
                  role="tabpanel"
                  aria-labelledby={`weekday-${i}`}
                  className={`day-column ${i === today ? 'today' : ''}`}
                >
                  <header>
                    <h2>{day}</h2>
                    <span>{i === today ? '今天' : String(i + 1).padStart(2, '0')}</span>
                  </header>
                  <div className="day-items">
                    {slots
                      .filter((a) => a.day === i)
                      .sort(
                        (a, b) =>
                          (a.time || '99:99').localeCompare(b.time || '99:99') ||
                          a.title.localeCompare(b.title),
                      )
                      .map((item) => (
                        <article className="airing-card" key={item.id}>
                          <a href={`#/subject/${item.id}`} className="airing-poster">
                            <Poster
                              url={item.image}
                              bangumiId={item.bangumiId}
                              title={item.title}
                            />
                          </a>
                          <div className="airing-info">
                            <time className="font-mono">{item.time || '时刻未提供'}</time>
                            <h3>
                              <a href={`#/subject/${item.id}`}>{item.title}</a>
                            </h3>
                            <p>
                              {item.latestEpisode
                                ? `最近有播出日期的章节 · 第 ${item.latestEpisode.sort} 话（${item.latestEpisode.air_date}）`
                                : '暂无带播出日期的正篇章节'}
                            </p>
                            {item.totalEpisodes && <p>全季共 {item.totalEpisodes} 话</p>}
                            <div className="flex flex-wrap items-center gap-2">
                              {item.latestEpisode ? (
                                <button
                                  disabled={!!busy}
                                  className={item.watched ? 'seen' : 'watch-status'}
                                  onClick={() => void mark(item)}
                                  aria-label={`${item.title}，${item.watched ? '已看，点击标为未看' : '标为已看'}`}
                                >
                                  {item.watched ? (
                                    <>
                                      <Check size={12} />
                                      已看
                                    </>
                                  ) : item.collection === 'doing' ? (
                                    '在看 · 标记已看'
                                  ) : (
                                    '未看 · 标记已看'
                                  )}
                                </button>
                              ) : (
                                <a className="text-xs underline" href={`#/subject/${item.id}`}>
                                  查看章节
                                </a>
                              )}
                              <Feel value={item.feeling} />
                            </div>
                          </div>
                        </article>
                      ))}
                    {!slots.some((a) => a.day === i) && (
                      <p className="day-empty">{day}暂无放送动画，留一点空白。</p>
                    )}
                  </div>
                </section>
              ),
          )}
        </div>
      )}
      <p className="footnote">放送日不等于平台上线日；节目延期与资源更新时间需以官方消息为准。</p>
    </section>
  );
}
