import { useState } from 'react';
import { Search } from 'lucide-react';
import { api, useRemote } from './lib/api';
import { Button } from './components/ui/button';
import { Empty, ErrorNotice, Skeleton, SectionTitle } from './components/common';
import { NoteCard } from './components/NoteCard';
import { SubjectGrid } from './Catalog';
import type { Page, Subject, Note } from './types';
import { noteTitle } from './lib/noteTitle';

function NoteIndexRow({
  note,
  revision,
  onChanged,
  onEdit,
  onDeleted,
}: {
  note: Note;
  revision: number;
  onChanged: () => void;
  onEdit: (note: Note) => void;
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const full = useRemote<Note | null>(`${note.id}:${open}:${revision}`, (signal) =>
    open ? api(`/api/me/notes/${note.id}`, { signal }) : Promise.resolve(null),
  );
  return (
    <details className="note-index-row" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{noteTitle(note)}</summary>
      {open &&
        (full.loading ? (
          <Skeleton />
        ) : full.error ? (
          <ErrorNotice message={full.error} retry={full.reload} />
        ) : (
          full.data && (
            <NoteCard
              note={full.data}
              onEdit={onEdit}
              onChanged={onChanged}
              onDeleted={onDeleted}
            />
          )
        ))}
    </details>
  );
}
export function NoteList({
  subjectId,
  episodeId,
  scope,
  revision,
  onChanged,
  onEdit,
  onDeleted,
  meaningfulOnly = true,
  compact = false,
  searchable = true,
}: {
  subjectId?: string;
  episodeId?: string;
  scope?: string;
  revision: number;
  onChanged: () => void;
  onEdit: (n: Note) => void;
  onDeleted?: (id: string) => void;
  meaningfulOnly?: boolean;
  compact?: boolean;
  searchable?: boolean;
}) {
  const [q, setQ] = useState(''),
    [active, setActive] = useState(''),
    [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), limit: '20' });
  if (subjectId) params.set('subjectId', subjectId);
  if (episodeId) params.set('episodeId', episodeId);
  if (scope) params.set('scope', scope);
  if (active) params.set('q', active);
  if (meaningfulOnly) params.set('meaningful', 'true');
  if (compact) params.set('view', 'index');
  const result = useRemote<Page<Note>>(`${params}:${revision}`, (signal) =>
    api(`/api/me/notes?${params}`, { signal }),
  );
  return (
    <>
      {searchable && (
        <form
          className="note-search"
          onSubmit={(e) => {
            e.preventDefault();
            setActive(q);
            setPage(1);
          }}
        >
          <label className="search-box">
            <Search size={17} />
            <input
              aria-label="搜索笔记正文"
              placeholder="搜索标题、正文与名场面……"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <Button variant="outline" type="submit">
            检索
          </Button>
        </form>
      )}
      {result.error ? (
        <ErrorNotice message={result.error} retry={result.reload} />
      ) : result.loading ? (
        <Skeleton />
      ) : result.data?.items.length ? (
        result.data.items.map((n) =>
          compact ? (
            <NoteIndexRow
              key={n.id}
              note={n}
              revision={revision}
              onEdit={onEdit}
              onDeleted={() => onDeleted?.(n.id)}
              onChanged={() => {
                result.reload();
                onChanged();
              }}
            />
          ) : (
            <NoteCard
              key={n.id}
              note={n}
              onDeleted={() => onDeleted?.(n.id)}
              onEdit={onEdit}
              onChanged={() => {
                result.reload();
                onChanged();
              }}
            />
          ),
        )
      ) : compact ? (
        <p className="empty-index">
          {active
            ? '没有找到匹配的记录。'
            : scope === 'overall'
              ? '还没有文字记录。评分无需写总评，想写时再留下感想。'
              : '还没有单集笔记，想记录时再留下感想。'}
        </p>
      ) : (
        <Empty
          title={active ? '没有找到匹配的笔记' : '这里还没有记录'}
          description={active ? '试试其他关键词。' : '选一部番剧，留下第一句感想。'}
        />
      )}
      {(!compact || (result.data?.total || 0) > 20) && (
        <div className="pagination">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
            上一页
          </Button>
          <span>
            {result.data?.total || 0} 则 · 第 {page} 页
          </span>
          <Button
            variant="ghost"
            disabled={page * 20 >= (result.data?.total || 0)}
            onClick={() => setPage((n) => n + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </>
  );
}
export default function NotesPage({
  mode,
  revision,
  onChanged,
  onEdit,
}: {
  mode: 'library' | 'notes' | 'reviews';
  revision: number;
  onChanged: () => void;
  onEdit: (n: Note) => void;
}) {
  const [status, setStatus] = useState(''),
    [page, setPage] = useState(1);
  const result = useRemote<Page<Subject>>(`${mode}:${status}:${page}:${revision}`, (signal) =>
    mode === 'library'
      ? api(`/api/me/collections?status=${status}&page=${page}&limit=24`, { signal })
      : Promise.resolve({ items: [], total: 0, page: 1, limit: 24 }),
  );
  return (
    <section>
      <div className="page-heading">
        <p className="eyebrow text-brand">
          {mode === 'library'
            ? 'MY WATCHLIST'
            : mode === 'reviews'
              ? 'MY REVIEWS'
              : 'MY MARGINAL NOTES'}
        </p>
        <h1>
          {mode === 'library'
            ? '留给自己的放映清单。'
            : mode === 'reviews'
              ? '旅途之后，回望整个故事。'
              : '故事之外，我的碎片。'}
        </h1>
        <p>
          {mode === 'library'
            ? '想看的、正在看的，以及那些看完仍难忘的。'
            : '点击标题，阅读完整记录。'}
        </p>
      </div>
      <nav className="library-sections" aria-label="我的追番内容">
        {[
          ['library', '番剧'],
          ['notes', '笔记'],
          ['reviews', '总评'],
        ].map(([value, label]) => (
          <a
            key={value}
            href={value === 'library' ? '#/library' : `#/library/${value}`}
            aria-current={mode === value ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      {mode !== 'library' ? (
        <NoteList
          key={mode}
          compact
          scope={mode === 'reviews' ? 'overall' : 'episode'}
          revision={revision}
          onChanged={onChanged}
          onEdit={onEdit}
        />
      ) : (
        <>
          <div className="library-filters">
            {[
              ['', '全部'],
              ['doing', '在看'],
              ['wish', '想看'],
              ['done', '看完'],
              ['hold', '搁置'],
              ['dropped', '弃番'],
            ].map(([value, label]) => (
              <button
                aria-pressed={status === value}
                className={status === value ? 'selected' : ''}
                key={value}
                onClick={() => {
                  setStatus(value);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {result.error ? (
            <ErrorNotice message={result.error} retry={result.reload} />
          ) : result.loading ? (
            <Skeleton />
          ) : result.data?.items.length ? (
            <SubjectGrid items={result.data.items} />
          ) : (
            <Empty title="清单里还没有番剧" description="从资料库找到一部作品，在详情页加入追番。">
              <a className="button button-outline" href="#/catalog">
                去找番
              </a>
            </Empty>
          )}
          <div className="pagination">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
              上一页
            </Button>
            <span>{result.data?.total || 0} 部</span>
            <Button
              variant="outline"
              disabled={page * 24 >= (result.data?.total || 0)}
              onClick={() => setPage((n) => n + 1)}
            >
              下一页
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
