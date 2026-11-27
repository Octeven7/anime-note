import { useState } from 'react';
import { PenLine, Check, Bookmark, RefreshCw, ShieldAlert, ExternalLink } from 'lucide-react';
import { api, useRemote, formatDate } from './lib/api';
import { Button } from './components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
import { Poster, Feel, Empty, ErrorNotice, Skeleton, SectionTitle } from './components/common';
import { NoteList } from './NotesPage';
import { NoteBody } from './Markdown';
import { SubjectRating } from './components/SubjectRating';
import { useSubject } from './lib/useSubject';
import type { Subject, Episode, Note, Progress, Ratings, Feeling, Impression, Page } from './types';
const refreshLabels = {
  all: '全部资料',
  ratings: '评分人数与分布',
  episodes: '章节信息',
  characters: '角色与声优',
  staff: '制作人员',
  metadata: '简介与基础资料',
};

export default function Detail({
  id,
  revision,
  onChanged,
  onRecord,
  onEdit,
}: {
  id: string;
  revision: number;
  onChanged: () => void;
  onRecord: (s: Subject, e?: Episode, n?: Note) => void;
  onEdit: (n: Note) => void;
}) {
  const [refreshSection, setRefreshSection] = useState<keyof typeof refreshLabels>('all');
  const [tab, setTab] = useState('summary'),
    [extras, setExtras] = useState(false),
    [visible, setVisible] = useState(50),
    [castLimit, setCastLimit] = useState(12),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [watchBusy, setWatchBusy] = useState<string | null>(null);
  const detail = useSubject(id);
  const personal = useRemote<{
    progress: Progress;
    ratings: Ratings;
    summary: {
      episodes: {
        episodeId: string;
        noteCount: number;
        feeling: Feeling | null;
        spoiler: boolean;
      }[];
    };
  }>(`${id}:${revision}`, async (signal) => {
    const [progress, ratings, summary] = await Promise.all([
      api<Progress>(`/api/me/subjects/${id}/progress`, { signal }),
      api<Ratings>(`/api/me/subjects/${id}/ratings`, { signal }),
      api<{
        episodes: {
          episodeId: string;
          noteCount: number;
          feeling: Feeling | null;
          spoiler: boolean;
        }[];
      }>(`/api/me/subjects/${id}/notebook`, { signal }),
    ]);
    return { progress, ratings, summary };
  });
  const s = detail.data;
  const progress = personal.data?.progress;
  const collectionStatus = progress?.collection?.status;
  const showProgress = collectionStatus === 'doing' || collectionStatus === 'hold';
  const mainEpisodes = s?.episodes?.filter((e) => e.type === 0) || [],
    episodes = extras ? s?.episodes || [] : mainEpisodes;
  const watched = new Set(progress?.episodes.filter((e) => e.watched).map((e) => e.episode_id));
  const next =
    mainEpisodes.find((e) => !watched.has(e.id)) || mainEpisodes[mainEpisodes.length - 1];
  async function setStatus(status: string | null) {
    setBusy(true);
    setMessage('');
    try {
      await api(`/api/me/subjects/${id}/collection`, { method: 'PUT', body: { status } });
      onChanged();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(ep: Episode) {
    if (watchBusy) return;
    setWatchBusy(ep.id);
    try {
      await api(`/api/me/subjects/${id}/episodes/${ep.id}`, {
        method: 'PUT',
        body: { watched: !watched.has(ep.id) },
      });
      onChanged();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setWatchBusy(null);
    }
  }
  async function refresh() {
    if (!s) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ results: { section: keyof typeof refreshLabels; ok: boolean }[] }>(
        `/api/integrations/bangumi/subjects/${s.bangumi_id}/refresh`,
        { method: 'POST', body: { section: refreshSection } },
      );
      setMessage(
        result.results
          .map(
            (item) =>
              `${refreshLabels[item.section]}${item.ok ? '已更新' : '更新失败，保留已有资料'}`,
          )
          .join('；'),
      );
      detail.reload();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (detail.loading) return <Skeleton />;
  if (detail.error) return <ErrorNotice message={detail.error} retry={detail.reload} />;
  if (!s) return null;
  if (s.restricted)
    return (
      <div className="restricted">
        <ShieldAlert size={40} />
        <h1 className="font-editorial text-3xl">此条目包含成人内容</h1>
        <p>当前个人版不展示 R18 资料与海报。</p>
        <a href="#/catalog">返回资料库</a>
      </div>
    );
  const studio =
    s.persons
      ?.filter((p) => ['动画制作', '制作'].includes(p.relation))
      .map((p) => p.name)
      .join(' / ') ||
    s.infobox
      ?.filter((i) => ['动画制作', '制作'].includes(i.key))
      .map((i) => (typeof i.value === 'string' ? i.value : i.value.map((v) => v.v).join(' / ')))
      .join(' / ') ||
    '制作信息待补充';
  return (
    <>
      <div className="detail-layout">
        <aside className="sidebar">
          <Poster url={s.image_url} bangumiId={s.bangumi_id} title={s.name_cn || s.name} priority />
          <div className="rating">
            <div>
              <span className="eyebrow">BANGUMI SCORE</span>
              <div className="flex items-baseline gap-2">
                <strong>{s.score ? s.score.toFixed(1) : '—'}</strong>
              </div>
            </div>
            <span className="text-sm text-muted">
              {s.rating_count === null
                ? '评分人数待补充'
                : `${s.rating_count.toLocaleString()} 人评分`}
              <br />
              <small>社区评分</small>
              {s.rating_updated_at && (
                <>
                  <br />
                  <small title="评分与人数最近同步时间">
                    {'更新于 '}
                    {formatDate(s.rating_updated_at)}
                  </small>
                </>
              )}
            </span>
          </div>
          <div className="progress-section">
            <div className="flex justify-between">
              <span>我的进度</span>
              <span className="font-mono text-muted">
                {showProgress
                  ? `${mainEpisodes.filter((e) => watched.has(e.id)).length} / ${mainEpisodes.length || '?'}`
                  : ({ wish: '想看', done: '看完', dropped: '弃番' } as Record<string, string>)[
                      collectionStatus || ''
                    ] || '未收藏'}
              </span>
            </div>
            {showProgress && (
              <progress
                max={mainEpisodes.length || 1}
                value={mainEpisodes.filter((e) => watched.has(e.id)).length}
                aria-label="观看进度"
              />
            )}
            <p className="text-sm text-muted">
              {progress?.collection
                ? showProgress
                  ? '正在旅途之中，慢慢看就好。'
                  : '每段旅途，都有自己的节奏。'
                : '尚未收藏，把这段旅途放进手账。'}
            </p>
          </div>
          <SubjectRating subjectId={id} revision={revision} onChanged={onChanged} />
          <Button className="w-full" onClick={() => onRecord(s)}>
            <PenLine size={17} />
            写整体评价
          </Button>
          {!progress?.collection && !personal.loading && (
            <Button
              variant="outline"
              className="w-full mt-2"
              disabled={busy || personal.loading || !!personal.error}
              onClick={() => void setStatus('doing')}
            >
              <Bookmark size={16} />
              加入我的追番
            </Button>
          )}
          {progress?.collection && (
            <label className="collection-select">
              追番状态
              <select
                aria-label="追番状态"
                value={progress.collection.status}
                disabled={busy}
                onChange={(e) => void setStatus(e.target.value)}
              >
                {[
                  ['wish', '想看'],
                  ['doing', '在看'],
                  ['done', '看完'],
                  ['hold', '搁置'],
                  ['dropped', '弃番'],
                ].map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="sidebar-foot">每一集，都值得留下一点什么。</p>
        </aside>
        <div className="detail-main">
          <div className="subject-heading">
            <div className="flex items-center gap-3">
              <span className="subject-season text-brand">
                {s.air_date
                  ? `${s.air_date.slice(0, 4)} · ${['冬', '春', '夏', '秋'][Math.floor((Number(s.air_date.slice(5, 7)) - 1) / 3)]}季`
                  : '播出日期待定'}
              </span>
              <span className="tiny-label">{s.platform || '动画'}</span>
            </div>
            <h1 className="subject-title line-clamp-2" title={s.name_cn || s.name}>
              {s.name_cn || s.name}
            </h1>
            {s.name_cn && (
              <p className="japanese">
                {s.name}
                <span className="title-rule" />
              </p>
            )}
            <div className="metadata">
              <span>{s.air_date || '日期待定'} 首播</span>
              <span>{s.totalEpisodes ? `共 ${s.totalEpisodes} 话` : '总话数未公布或未收录'}</span>
              <span>{`已收录正篇 ${mainEpisodes.length} 话`}</span>
              <span>{studio}</span>
            </div>
            <div className="tags">
              {s.tags.slice(0, 20).map((t) => (
                <a className="tag" key={t} href={`#/catalog?tag=${encodeURIComponent(t)}`}>
                  {t}
                </a>
              ))}
            </div>
          </div>
          {message && (
            <p className="text-sm text-muted" role="alert">
              {message}
            </p>
          )}
          {personal.error && <ErrorNotice message={personal.error} retry={personal.reload} />}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="tabs" aria-label="作品内容">
              {[
                ['summary', '概览'],
                ['episodes', '章节'],
                ['cast', '角色与声优'],
                ['notes', '我的笔记'],
              ].map(([key, label]) => (
                <TabsTrigger key={key} value={key}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="summary" className="tab-content">
              <section className="overview-reviews">
                <div className="section-top">
                  <SectionTitle title="我的整体评价" en="AFTER THE JOURNEY" />
                  <Button variant="outline" onClick={() => onRecord(s)}>
                    <PenLine size={16} />
                    写总评
                  </Button>
                </div>
                <NoteList
                  compact
                  searchable={false}
                  subjectId={id}
                  scope="overall"
                  revision={revision}
                  onChanged={onChanged}
                  onEdit={onEdit}
                />
              </section>
              <SectionTitle title="关于这个故事" en="THE STORY" />
              {s.summary ? (
                <div className="summary-copy whitespace-pre-wrap">{s.summary}</div>
              ) : (
                <Empty title="暂时没有简介" description="先从第一集认识这个故事吧。" />
              )}
              {!!s.infobox?.length && (
                <details className="infobox">
                  <summary>制作与作品资料</summary>
                  <dl>
                    {s.infobox.map((entry, i) => (
                      <div key={i}>
                        <dt>{entry.key}</dt>
                        <dd>
                          {typeof entry.value === 'string'
                            ? entry.value
                            : entry.value.map((v) => v.v).join(' / ')}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </TabsContent>
            <TabsContent value="episodes" className="tab-content">
              <div className="flex justify-end mb-4">
                <Button disabled={!next} onClick={() => onRecord(s, next)}>
                  <PenLine size={16} />
                  记录本集 {next ? `EP.${next.sort}` : ''}
                </Button>
              </div>
              <div className="section-top">
                <SectionTitle title="一集一页，慢慢记" en="EPISODE JOURNAL" />
                <label className="text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={extras}
                    onChange={(e) => {
                      setExtras(e.target.checked);
                      setVisible(50);
                    }}
                  />{' '}
                  包含特别篇 / OP / ED
                </label>
              </div>
              <div className="episode-list">
                {episodes.slice(0, visible).map((ep) => {
                  const summary = personal.data?.summary.episodes.find(
                    (n) => n.episodeId === ep.id,
                  );
                  return (
                    <div className="episode-row" key={ep.id}>
                      <button
                        className={`watch-toggle ${watched.has(ep.id) ? 'checked' : ''}`}
                        aria-label={`第 ${ep.sort} 话${watched.has(ep.id) ? '标记未看' : '标记已看'}`}
                        aria-pressed={watched.has(ep.id)}
                        disabled={!!watchBusy || personal.loading || !!personal.error}
                        onClick={() => void toggle(ep)}
                      >
                        {watched.has(ep.id) ? <Check size={14} /> : <span />}
                      </button>
                      <span className="episode-number">{ep.sort}</span>
                      <button className="episode-title" onClick={() => onRecord(s, ep)}>
                        <strong>
                          {ep.type !== 0 && (
                            <small>
                              {(['正篇', '特别篇', 'OP', 'ED', '预告', 'MAD', '其他'][ep.type] ||
                                '其他') + ' · '}
                            </small>
                          )}
                          {ep.name_cn || ep.name || `第 ${ep.sort} 话`}
                        </strong>
                        <time>{ep.air_date || '播出日待定'}</time>
                      </button>
                      <div className="episode-badges">
                        <Feel value={summary?.feeling} />
                        <span className="note-count">
                          <PenLine size={13} />
                          {summary?.noteCount || 0}
                        </span>
                        {summary?.spoiler && <span>剧透</span>}
                      </div>
                      <button
                        className="row-action"
                        aria-label={`记录第 ${ep.sort} 话`}
                        onClick={() => onRecord(s, ep)}
                      >
                        <PenLine size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
              {!episodes.length && (
                <div className="py-4 text-sm text-muted">
                  <Button variant="ghost" disabled={busy} onClick={() => void refresh()}>
                    重试获取章节
                  </Button>
                </div>
              )}
              {episodes.length > visible && (
                <Button variant="outline" onClick={() => setVisible((n) => n + 50)}>
                  显示更多章节
                </Button>
              )}
              <p className="footnote">感想不必每集都有。只记住，你想记住的。</p>
            </TabsContent>
            <TabsContent value="cast" className="tab-content">
              <SectionTitle title="与旅途中的人相遇" en="CHARACTERS & VOICES" />
              <div className="cast-grid">
                {s.characters?.slice(0, castLimit).map((c) => (
                  <article className="cast-card" key={c.id}>
                    {c.payload.images?.medium ? (
                      <img
                        className="cast-avatar"
                        src={c.payload.images.medium}
                        alt={c.name}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="cast-avatar">{c.name[0]}</div>
                    )}
                    <div>
                      <h3 className="font-editorial text-lg">{c.name}</h3>
                      <p className="text-xs text-muted">{c.relation}</p>
                      <p className="text-sm mt-2">
                        CV · {c.actors.map((a) => a.name).join(' / ') || '暂未收录'}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
              {!s.characters?.length && <Empty title="暂未收录角色资料" />}
              {(s.characters?.length || 0) > castLimit && (
                <Button variant="outline" onClick={() => setCastLimit((n) => n + 24)}>
                  更多角色与声优
                </Button>
              )}
            </TabsContent>
            <TabsContent value="notes" className="tab-content">
              <SectionTitle title="我的观看碎片" en="MARGINAL NOTES" />
              <NoteList
                compact
                subjectId={id}
                scope="episode"
                revision={revision}
                onChanged={onChanged}
                onEdit={onEdit}
              />
            </TabsContent>
          </Tabs>
          <Discussion subjectId={id} episodes={s.episodes || []} revision={revision} />
          <div className="source-footer">
            <a href={`https://bgm.tv/subject/${s.bangumi_id}`} target="_blank" rel="noreferrer">
              <ExternalLink size={13} />
              资料来源：Bangumi
            </a>
            <span>基础资料获取：{formatDate(s.source?.fetchedAt)}</span>
            <select
              aria-label="刷新范围"
              value={refreshSection}
              disabled={busy}
              onChange={(event) =>
                setRefreshSection(event.target.value as keyof typeof refreshLabels)
              }
            >
              {Object.entries(refreshLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Button variant="ghost" disabled={busy} onClick={() => void refresh()}>
              <RefreshCw size={13} />
              {busy ? '正在更新…' : '刷新资料'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
function Discussion({
  subjectId,
  episodes,
  revision,
}: {
  subjectId: string;
  episodes: Episode[];
  revision: number;
}) {
  const [page, setPage] = useState(1),
    [revealed, setRevealed] = useState<Record<string, Impression>>({}),
    [error, setError] = useState('');
  const remote = useRemote<Page<Impression>>(`${subjectId}:${revision}:${page}`, (signal) =>
    api(`/api/catalog/${subjectId}/impressions?page=${page}`, { signal }),
  );
  async function reveal(id: string) {
    try {
      const response = await api<Page<Impression>>(
        `/api/catalog/${subjectId}/impressions?noteId=${id}&includeSpoilers=true`,
      );
      if (response.items[0]) setRevealed((r) => ({ ...r, [id]: response.items[0] }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="discussion">
      <SectionTitle title="作品感想区" en="SHARED IMPRESSIONS" />
      {error && <ErrorNotice message={error} />}
      {remote.error ? (
        <ErrorNotice message={remote.error} retry={remote.reload} />
      ) : remote.data?.items.length ? (
        remote.data.items.map((original) => {
          const row =
            revealed[original.noteId]?.version === original.version
              ? revealed[original.noteId]
              : original;
          return (
            <article className="history-item" key={row.noteId}>
              <p className="text-sm text-muted">
                {row.author} ·{' '}
                {row.scope === 'overall'
                  ? '整体感想'
                  : `第 ${episodes.find((e) => e.id === row.episodeId)?.sort ?? '?'} 话`}{' '}
                · {formatDate(row.createdAt)}
              </p>
              {row.hidden ? (
                <Button variant="outline" onClick={() => void reveal(row.noteId)}>
                  含剧透 · 主动展开阅读
                </Button>
              ) : (
                <>
                  <Feel value={row.feeling} />
                  {row.score !== null && row.score !== undefined && (
                    <p className="text-sm mt-2">
                      整体评分 <strong className="font-mono">{row.score} / 10</strong>
                    </p>
                  )}
                  {row.title && <h3 className="font-editorial text-lg">{row.title}</h3>}
                  <NoteBody body={row.body || ''} />
                  {row.scenes?.map((s, i) => (
                    <p className="scene-line" key={i}>
                      {s.time} · {s.text}
                    </p>
                  ))}
                  {row.spoiler && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setRevealed((r) => {
                          const next = { ...r };
                          delete next[row.noteId];
                          return next;
                        })
                      }
                    >
                      重新隐藏
                    </Button>
                  )}
                </>
              )}
            </article>
          );
        })
      ) : (
        <p className="text-muted text-sm">还没有公开感想。私密记录和草稿不会出现在这里。</p>
      )}
      {(remote.data?.total || 0) > 20 && (
        <div className="pagination">
          <Button variant="ghost" disabled={page === 1} onClick={() => setPage((n) => n - 1)}>
            上一页
          </Button>
          <Button
            variant="ghost"
            disabled={page * 20 >= (remote.data?.total || 0)}
            onClick={() => setPage((n) => n + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </section>
  );
}
