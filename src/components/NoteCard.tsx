import { useState } from 'react';
import { Pencil, Trash2, History, Download, EyeOff } from 'lucide-react';
import { Button } from './ui/button';
import { Feel } from './common';
import { NoteBody } from '../Markdown';
import { api, download, formatDate } from '../lib/api';
import type { Note } from '../types';
import { noteTitle } from '../lib/noteTitle';
export function meaningful(n: Note) {
  return !!(
    n.draft.title?.trim() ||
    n.draft.body.trim() ||
    n.draft.feeling ||
    n.draft.scenes.some((scene) => scene.text.trim()) ||
    n.published
  );
}
export function NoteCard({
  note,
  onEdit,
  onChanged,
  onDeleted,
  hideTitle = false,
}: {
  note: Note;
  onEdit: (n: Note) => void;
  onChanged: () => void;
  onDeleted?: () => void;
  hideTitle?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<
      | {
          body: string;
          version: number;
          createdAt: string;
          isPublic: boolean;
          spoiler: boolean | null;
          score?: number | null;
        }[]
      | null
    >(null);
  const action = async (name: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (name === 'delete') {
        await api(`/api/me/notes/${note.id}`, {
          method: 'DELETE',
          body: { expectedVersion: note.version },
        });
        onDeleted?.();
      } else if (name === 'unpublish')
        await api(`/api/me/notes/${note.id}/unpublish`, {
          method: 'POST',
          body: { expectedVersion: note.version },
        });
      else {
        const result = await api<{ items: NonNullable<typeof history> }>(
          `/api/me/notes/${note.id}/history`,
        );
        setHistory(result.items);
        return;
      }
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const dirty =
    note.published &&
    ((note.draft.title ?? '') !== (note.published.title ?? '') ||
      note.draft.body !== note.published.body ||
      note.draft.feeling !== note.published.feeling ||
      JSON.stringify(note.draft.scenes) !== JSON.stringify(note.published.scenes) ||
      note.draft.isPublic !== note.published.isPublic);
  return (
    <article className="history-item note-card">
      {!hideTitle && <h3 className="font-editorial text-xl mb-3">{noteTitle(note)}</h3>}
      <NoteBody
        body={
          note.draft.body ||
          (!note.draft.feeling
            ? note.scope === 'overall' && note.published
              ? '本次未填写文字感想。'
              : '尚未填写正文。'
            : '')
        }
      />
      {note.draft.scenes.map((s, i) => (
        <p key={i} className="scene-line">
          {s.time ? `${s.time} · ` : ''}
          {s.text}
        </p>
      ))}
      <div className="note-metadata flex flex-wrap items-center gap-2 text-sm text-muted">
        <a href={`#/subject/${note.subjectId}`} className="note-subject">
          {note.subjectTitle}
        </a>
        <span>{note.scope === 'overall' ? '整体感想' : `第 ${note.episode?.sort ?? '?'} 话`}</span>
        <Feel value={note.draft.feeling} />
        {note.published?.score !== null && note.published?.score !== undefined && (
          <span>
            整体评分 <strong className="font-mono">{note.published.score} / 10</strong>
          </span>
        )}
        <span>
          {dirty || !note.published
            ? '草稿'
            : note.published.isPublic
              ? '已发表到本机感想区'
              : '私密记录'}
        </span>
        {dirty && <span className="text-brand">有未发布修改</span>}
        <time>{formatDate(note.updatedAt)}</time>
      </div>
      <div className="note-actions">
        <Button variant="ghost" onClick={() => onEdit(note)}>
          <Pencil size={14} />
          编辑 / 可见性
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void action('history')}>
          <History size={14} />
          历史
        </Button>
        {note.published?.isPublic && (
          <Button variant="ghost" disabled={busy} onClick={() => void action('unpublish')}>
            <EyeOff size={14} />
            撤回公开
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() =>
            download(
              `${note.subjectTitle}-${note.scope === 'overall' ? '总评' : note.episode?.sort}.md`,
              `# ${noteTitle(note)}\n\n${note.subjectTitle} · ${note.scope === 'overall' ? '整体感想' : `第 ${note.episode?.sort} 话`}\n\n${note.draft.body}\n\n${note.draft.scenes.map((s) => `- ${s.time} ${s.text}`).join('\n')}`,
            )
          }
        >
          <Download size={14} />
          导出
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
          <Trash2 size={14} />
          删除
        </Button>
      </div>
      {confirming && (
        <div className="inline-notice" role="alert">
          <p>将这条记录移入回收站？之后可以恢复。</p>
          <div className="flex gap-2 mt-2">
            <Button disabled={busy} onClick={() => void action('delete')}>
              确认移入回收站
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              取消
            </Button>
          </div>
        </div>
      )}
      {history && (
        <details className="revision-list" open>
          <summary onClick={() => setHistory(null)}>发布历史（{history.length}）· 收起</summary>
          {history.map((r) => (
            <div key={r.version}>
              <p className="text-sm text-muted">
                版本 {r.version} · {formatDate(r.createdAt)} ·{' '}
                {r.isPublic ? '当时公开' : '当时私密'}
                {r.score !== null && r.score !== undefined && ` · ${r.score} / 10`}
              </p>
              {r.spoiler ? (
                <details className="spoiler-block">
                  <summary>历史内容含剧透 · 展开</summary>
                  <NoteBody body={r.body} />
                </details>
              ) : (
                <NoteBody body={r.body} />
              )}
            </div>
          ))}
        </details>
      )}
      {error && (
        <p className="error text-sm" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
