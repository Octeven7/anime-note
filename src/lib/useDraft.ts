import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import type { Content, Note } from '../types';
export const emptyContent = (): Content => ({
  title: '',
  body: '',
  feeling: null,
  scenes: [],
  isPublic: false,
});
const contentOf = (n: Note): Content => ({
  title: n.draft.title || '',
  body: n.draft.body,
  feeling: n.draft.feeling,
  scenes: n.draft.scenes,
  isPublic: n.draft.isPublic,
});
export const contentHash = (c: Content) =>
  JSON.stringify([c.title || '', c.body, c.feeling, c.scenes, c.isPublic]);
export const hasNoteContent = (c: Content) =>
  !!(c.title?.trim() || c.body.trim() || c.feeling || c.scenes.some((scene) => scene.text.trim()));
interface Recovery {
  noteId?: string;
  key: string;
  content: Content;
  baseVersion?: number;
}
export function useDraft(
  target: { subjectId: string; episodeId?: string; scope: 'episode' | 'overall'; note?: Note },
  onSaved: () => void,
) {
  const recoveryKey = `paper-screen:recovery:v2:${target.note?.id || `${target.subjectId}:${target.episodeId || 'overall'}`}`;
  const [initial] = useState<Recovery>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(recoveryKey) || 'null');
      if (
        saved &&
        saved.content &&
        typeof saved.content.body === 'string' &&
        Array.isArray(saved.content.scenes) &&
        typeof saved.key === 'string'
      )
        return saved;
    } catch {}
    return {
      key: crypto.randomUUID(),
      noteId: target.note?.id,
      content: target.note ? contentOf(target.note) : emptyContent(),
      baseVersion: target.note?.version,
    };
  });
  const [content, setContent] = useState<Content>(initial.content);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('正在读取草稿');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const note = useRef<Note | null>(target.note || null),
    latest = useRef(content),
    savedHash = useRef(
      target.note ? contentHash(contentOf(target.note)) : contentHash(emptyContent()),
    ),
    queue = useRef<Promise<unknown>>(Promise.resolve()),
    mounted = useRef(true),
    blocked = useRef(false),
    onSavedRef = useRef(onSaved),
    publishSignature = useRef(''),
    initialization = useRef(0),
    finished = useRef(false);
  onSavedRef.current = onSaved;
  latest.current = content;
  const keepRecovery = () => {
    if (finished.current) return;
    try {
      if (!note.current && !initial.noteId && !hasNoteContent(latest.current)) {
        localStorage.removeItem(recoveryKey);
        return;
      }
      localStorage.setItem(
        recoveryKey,
        JSON.stringify({
          noteId: note.current?.id || initial.noteId,
          key: initial.key,
          content: latest.current,
          baseVersion: note.current?.version ?? initial.baseVersion,
        }),
      );
    } catch {
      /* A server save can still succeed without browser storage. */
    }
  };
  const report = (e: Error) => {
    if (e instanceof ApiError && e.status === 409) {
      blocked.current = true;
      setConflict(true);
    }
    if (mounted.current) {
      setStatus('保存失败');
      setError(e.message);
    }
    keepRecovery();
  };
  const init = async () => {
    const ticket = ++initialization.current;
    setError('');
    try {
      if (!initial.noteId) {
        setReady(true);
        setStatus(hasNoteContent(latest.current) ? '等待保存' : '尚未记录 · 输入后自动保存');
        return;
      }
      const n = await api<Note>(`/api/me/notes/${initial.noteId}`);
      if (!mounted.current || ticket !== initialization.current) return;
      note.current = n;
      savedHash.current = contentHash(contentOf(n));
      if (
        initial.baseVersion !== undefined &&
        initial.baseVersion !== n.version &&
        contentHash(initial.content) !== savedHash.current
      ) {
        blocked.current = true;
        setConflict(true);
        setError('服务器版本已经变化。本地恢复内容已保留，请导出后再读取服务器版本。');
        setStatus('版本冲突');
      } else {
        if (
          (!initial.noteId && contentHash(initial.content) === contentHash(emptyContent())) ||
          contentHash(initial.content) === savedHash.current
        ) {
          latest.current = contentOf(n);
          setContent(contentOf(n));
        }
        setStatus('草稿已就绪');
      }
      setReady(true);
      keepRecovery();
    } catch (e) {
      report(e as Error);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void init();
    return () => {
      mounted.current = false;
      initialization.current++;
      if (!finished.current) keepRecovery();
    };
  }, []);
  const flush = (allowEmpty = false) => {
    const run = queue.current.then(async () => {
      if (blocked.current)
        throw new ApiError(409, '存在版本冲突，请先保留本地内容并读取服务器版本。');
      if (!note.current) {
        if (!hasNoteContent(latest.current) && !allowEmpty) return null;
        // The fixed creation payload makes retries safe even if typing continues.
        note.current = await api<Note>('/api/me/notes', {
          method: 'POST',
          body: {
            subjectId: target.subjectId,
            episodeId: target.episodeId,
            scope: target.scope,
            idempotencyKey: initial.key,
          },
        });
        savedHash.current = contentHash(contentOf(note.current));
        keepRecovery();
      }
      const snapshot = structuredClone(latest.current),
        hash = contentHash(snapshot);
      if (hash === savedHash.current) return note.current;
      if (mounted.current) {
        setStatus('保存中');
        setError('');
      }
      const updated = await api<Note>(`/api/me/notes/${note.current.id}/draft`, {
        method: 'PUT',
        body: { ...snapshot, expectedVersion: note.current.version },
      });
      note.current = updated;
      savedHash.current = hash;
      keepRecovery();
      if (mounted.current) {
        setStatus(contentHash(latest.current) === hash ? '草稿已保存' : '等待保存');
        setError('');
        onSavedRef.current();
      }
      return updated;
    });
    queue.current = run.catch(() => {});
    return run.catch((e) => {
      report(e);
      throw e;
    });
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    keepRecovery();
    if (!ready || conflict) return;
    if (!note.current && !hasNoteContent(content)) {
      setStatus('尚未记录 · 输入后自动保存');
      return;
    }
    if (contentHash(content) === savedHash.current) {
      setStatus('草稿已保存');
      return;
    }
    setStatus('等待保存');
    const timer = setTimeout(() => {
      void flushRef.current().catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [content, ready, conflict]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (
        (note.current || hasNoteContent(latest.current)) &&
        contentHash(latest.current) !== savedHash.current
      ) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);
  const publish = async (spoiler: boolean | null, score?: number, ratingSnapshot?: number) => {
    try {
      const n = await flush(score !== undefined);
      if (!n) throw new Error('还没有记录内容，写下感想或选择一个观感后再保存。');
      if (latest.current.isPublic && spoiler === null)
        throw new Error('公开发布前请选择含剧透或不含剧透。');
      const signature =
        contentHash(latest.current) + JSON.stringify([spoiler, score, ratingSnapshot]);
      if (publishSignature.current === signature) return n;
      setStatus('发布中');
      const result = await api<Note>(`/api/me/notes/${n.id}/publish`, {
        method: 'POST',
        body: {
          expectedVersion: n.version,
          ...(latest.current.isPublic ? { spoiler } : {}),
          ...(score === undefined ? {} : { score }),
          ...(ratingSnapshot === undefined ? {} : { ratingSnapshot }),
        },
      });
      note.current = result;
      publishSignature.current = signature;
      keepRecovery();
      setStatus('已保存');
      setError('');
      onSavedRef.current();
      return result;
    } catch (e) {
      report(e as Error);
      throw e;
    }
  };
  const loadServer = async () => {
    if (!note.current) {
      void init();
      return;
    }
    try {
      const n = await api<Note>(`/api/me/notes/${note.current.id}`);
      note.current = n;
      latest.current = contentOf(n);
      setContent(contentOf(n));
      savedHash.current = contentHash(contentOf(n));
      publishSignature.current = '';
      blocked.current = false;
      setConflict(false);
      setError('');
      setStatus('已读取服务器版本');
      keepRecovery();
    } catch (e) {
      report(e as Error);
    }
  };
  return {
    content,
    setContent,
    ready,
    status,
    error,
    conflict,
    flush,
    publish,
    retry: () => (ready ? flush() : init()),
    loadServer,
    note,
    close: async () => {
      keepRecovery();
      if (!blocked.current) {
        await flush();
        if (!note.current || (!hasNoteContent(latest.current) && !note.current.published)) {
          if (note.current) {
            await api(`/api/me/notes/${note.current.id}`, {
              method: 'DELETE',
              body: { expectedVersion: note.current.version },
            });
          }
          finished.current = true;
          try {
            localStorage.removeItem(recoveryKey);
          } catch {}
          return;
        }
        if (
          note.current.published &&
          contentHash(note.current.published) === contentHash(latest.current)
        ) {
          finished.current = true;
          try {
            localStorage.removeItem(recoveryKey);
          } catch {}
        }
      }
    },
    recoveryKey,
    discardRecovery: () => {
      finished.current = true;
      blocked.current = true;
      try {
        localStorage.removeItem(recoveryKey);
      } catch {}
    },
  };
}
