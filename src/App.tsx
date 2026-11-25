import { Component, useEffect, useState, type ReactNode } from 'react';
import { BookOpen, CalendarDays, Sun, Moon, Search, Settings } from 'lucide-react';
import Catalog from './Catalog';
import Detail from './Detail';
import NotesPage from './NotesPage';
import Schedule from './Schedule';
import DataSettings from './DataSettings';
import Recorder from './Recorder';
import { api, useRemote } from './lib/api';
import { readLegacyBrowser } from './lib/legacy';
import { ErrorNotice } from './components/common';
import type { Subject, Episode, Note, Progress } from './types';
interface Editor {
  subject: Subject;
  episode?: Episode;
  note?: Note;
  key: string;
}
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="page-shell">
        <div className="empty">
          <h1>页面遇到了问题</h1>
          <p>{this.state.error}</p>
          <button className="button button-primary" onClick={() => location.reload()}>
            重新加载
          </button>
          <a href="/api/me/backup">下载数据库中的个人备份</a>
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
}
function route() {
  return (location.hash.slice(1) || '/catalog').split('?');
}
export default function App() {
  const [[path, query = ''], setRoute] = useState(route),
    [revision, setRevision] = useState(0),
    [editor, setEditor] = useState<Editor | null>(null),
    [error, setError] = useState('');
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('paper-screen:theme') === 'dark';
    } catch {
      return false;
    }
  });
  const reload = () => setRevision((n) => n + 1);
  const navigate = (url: string) => {
    location.hash = url;
  };
  useEffect(() => {
    const changed = () => {
      setRoute(route());
      setError('');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try {
      localStorage.setItem('paper-screen:theme', dark ? 'dark' : 'light');
    } catch {}
  }, [dark]);
  function openEditor(subject: Subject, episode?: Episode, note?: Note) {
    setEditor({
      subject,
      episode,
      note,
      key: `${note?.id || episode?.id || subject.id}:${crypto.randomUUID()}`,
    });
  }
  async function editNote(note: Note) {
    try {
      const subject = await api<Subject>(`/api/catalog/${note.subjectId}`);
      const episode = note.episodeId
        ? subject.episodes?.find((e) => e.id === note.episodeId)
        : undefined;
      if (note.episodeId && !episode)
        throw new Error('章节资料暂不可用，请打开作品刷新资料后重试。');
      openEditor(subject, episode, note);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const subjectId = path.startsWith('/subject/') ? path.slice(9) : null;
  let legacyNotice = false;
  try {
    legacyNotice =
      readLegacyBrowser().hasData && !localStorage.getItem('paper-screen:legacy-migrated-at');
  } catch {}
  return (
    <ErrorBoundary>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        跳到主要内容
      </a>
      <header className="site-header">
        <div className="header-inner">
          <button
            className="wordmark"
            onClick={() => navigate('/catalog')}
            aria-label="纸间放映首页"
          >
            <span className="logo-mark">
              <BookOpen size={21} />
            </span>
            <span>
              纸间放映<small>AN ANIME JOURNAL</small>
            </span>
          </button>
          <nav aria-label="主导航">
            {[
              { url: '/catalog', label: '找番', icon: Search },
              { url: '/library', label: '追番', icon: BookOpen },
              { url: '/schedule', label: '放送表', icon: CalendarDays },
              { url: '/settings', label: '数据', icon: Settings },
            ].map((n) => (
              <button
                key={n.url}
                className={
                  path === n.url ||
                  (n.url === '/library' && (path.startsWith('/library/') || path === '/notes')) ||
                  (n.url === '/catalog' && !!subjectId)
                    ? 'active'
                    : ''
                }
                aria-label={n.label}
                aria-current={
                  path === n.url ||
                  (n.url === '/library' && (path.startsWith('/library/') || path === '/notes'))
                    ? 'page'
                    : undefined
                }
                onClick={() => navigate(n.url)}
              >
                <n.icon size={17} />
                <span>{n.label}</span>
              </button>
            ))}
          </nav>
          <div className="header-tools">
            <button
              aria-label={dark ? '切换亮色模式' : '切换暗色模式'}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <span className="avatar" title="本机个人模式">
              我
            </span>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="page-shell">
        {error && <ErrorNotice message={error} />}
        {legacyNotice && (
          <p className="inline-notice">
            检测到旧版浏览器记录。
            <a href="#/settings" className="underline">
              前往数据页预检迁移
            </a>
            ，原始数据会保留。
          </p>
        )}
        <div className="breadcrumb">
          我的手账 /{' '}
          {subjectId
            ? '作品详情'
            : path === '/catalog'
              ? '番剧资料库'
              : path.startsWith('/library')
                ? '我的追番'
                : path === '/notes'
                  ? '观看笔记'
                  : path === '/schedule'
                    ? '放送表'
                    : '数据管理'}
        </div>
        {subjectId ? (
          <Detail
            key={subjectId}
            id={subjectId}
            revision={revision}
            onChanged={reload}
            onRecord={openEditor}
            onEdit={(n) => void editNote(n)}
          />
        ) : path === '/catalog' ? (
          <Catalog key={query} query={query} navigate={navigate} />
        ) : path === '/library' || path.startsWith('/library/') || path === '/notes' ? (
          <NotesPage
            key={path}
            mode={path.endsWith('/reviews') ? 'reviews' : path === '/library' ? 'library' : 'notes'}
            revision={revision}
            onChanged={reload}
            onEdit={(n) => void editNote(n)}
          />
        ) : path === '/schedule' ? (
          <Schedule revision={revision} onChanged={reload} />
        ) : path === '/settings' ? (
          <DataSettings revision={revision} onChanged={reload} />
        ) : (
          <ErrorNotice message="页面不存在，请从上方导航重新进入。" />
        )}
        <footer className="site-footer">
          <span>纸间放映 / 把看过的故事，留在纸上。</span>
          <span>
            个人本机版 · 资料来自{' '}
            <a href="https://bgm.tv" target="_blank" rel="noreferrer">
              Bangumi
            </a>{' '}
            · 记录保存在本机数据库
          </span>
        </footer>
      </main>
      {editor && (
        <EditorSurface
          key={editor.key}
          editor={editor}
          revision={revision}
          onClose={() => setEditor(null)}
          onSaved={reload}
          onEdit={(n) => void editNote(n)}
        />
      )}
    </ErrorBoundary>
  );
}
function EditorSurface({
  editor,
  revision,
  onClose,
  onSaved,
  onEdit,
}: {
  editor: Editor;
  revision: number;
  onClose: () => void;
  onSaved: () => void;
  onEdit: (n: Note) => void;
}) {
  const state = useRemote<Progress>(`${editor.subject.id}:${revision}`, (signal) =>
    api(`/api/me/subjects/${editor.subject.id}/progress`, { signal }),
  );
  const watched = !!state.data?.episodes.find((e) => e.episode_id === editor.episode?.id)?.watched;
  return (
    <Recorder
      subjectId={editor.subject.id}
      subjectTitle={editor.subject.name_cn || editor.subject.name}
      episode={editor.episode}
      note={editor.note}
      watched={watched}
      onWatched={
        editor.episode
          ? async () => {
              if (state.error) throw new Error(state.error);
              await api(`/api/me/subjects/${editor.subject.id}/episodes/${editor.episode!.id}`, {
                method: 'PUT',
                body: { watched: !watched },
              });
              onSaved();
            }
          : undefined
      }
      onClose={onClose}
      onSaved={onSaved}
      onEditHistory={onEdit}
    />
  );
}
