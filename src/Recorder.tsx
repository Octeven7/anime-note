import { useEffect, useRef, useState } from 'react';
import {
  X,
  Plus,
  Clock,
  Check,
  Pencil,
  Eye,
  EyeOff,
  Bold,
  Italic,
  Strikethrough,
  Underline,
  Download,
} from 'lucide-react';
import * as Switch from '@radix-ui/react-switch';
import { Button } from './components/ui/button';
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from './components/ui/dialog';
import { feelings, type Episode, type Note, type Content } from './types';
import { useDraft } from './lib/useDraft';
import { download } from './lib/api';
import { NoteList } from './NotesPage';
import { NoteBody } from './Markdown';
import { SubjectRating } from './components/SubjectRating';
import { normalizeTimestamp } from './lib/time';
export function Visibility({
  isPublic,
  spoiler,
  onChange,
}: {
  isPublic: boolean;
  spoiler: boolean | null;
  onChange: (p: boolean, s: boolean | null) => void;
}) {
  return (
    <section className="visibility">
      <div className="flex items-center justify-between gap-4">
        <div>
          <strong>{isPublic ? '准备公开到作品感想区' : '仅自己可见'}</strong>
          <p className="text-sm text-muted">
            {isPublic
              ? '公开内容可被阅读与引用；自动保存不会发布，需点击确认公开。'
              : '记录默认私密，公开状态由你单独决定。'}
          </p>
        </div>
        <Switch.Root
          className="switch"
          checked={isPublic}
          onCheckedChange={(v) => onChange(v, null)}
          aria-label="公开到作品感想区"
        >
          <Switch.Thumb className="switch-thumb" />
        </Switch.Root>
      </div>
      {isPublic && (
        <fieldset className="mt-4">
          <legend className="text-sm">本次发布必须重新声明剧透情况</legend>
          <div className="flex gap-4 mt-2">
            {[true, false].map((v) => (
              <label key={String(v)} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="spoiler"
                  checked={spoiler === v}
                  onChange={() => onChange(true, v)}
                />
                {v ? '含剧透' : '不含剧透'}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </section>
  );
}
export default function Recorder({
  subjectId,
  subjectTitle,
  episode,
  note,
  watched,
  onWatched,
  onClose,
  onSaved,
  onEditHistory,
}: {
  subjectId: string;
  subjectTitle: string;
  episode?: Episode;
  note?: Note;
  watched?: boolean;
  onWatched?: () => Promise<void>;
  onClose: () => void;
  onSaved: () => void;
  onEditHistory: (n: Note) => void;
}) {
  const [tick, setTick] = useState(0);
  const scope = episode ? 'episode' : 'overall';
  const draft = useDraft({ subjectId, episodeId: episode?.id, scope, note }, () => {
    setTick((n) => n + 1);
    onSaved();
  });
  const [spoiler, setSpoiler] = useState<boolean | null>(null),
    [ratingSnapshot, setRatingSnapshot] = useState<number | undefined>(),
    [preview, setPreview] = useState(false),
    [stamp, setStamp] = useState('00:00'),
    [busy, setBusy] = useState(false),
    [ratingBusy, setRatingBusy] = useState(false),
    [hint, setHint] = useState('');
  const area = useRef<HTMLTextAreaElement>(null),
    submitting = useRef(false);
  const patch = (value: Partial<Content>) => {
    draft.setContent((c) => ({ ...c, ...value }));
    setSpoiler(null);
    setHint('');
  };
  const submit = async () => {
    if (ratingBusy) {
      setHint('评分正在保存，请稍等。');
      return;
    }
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setHint('');
    try {
      await draft.publish(spoiler, undefined, ratingSnapshot);
      setHint('已保存到数据库。可以关闭，也可以继续编辑。');
    } catch {
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void submitRef.current();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const close = () => {
    void draft
      .close()
      .catch(() => {})
      .finally(onSaved);
    onClose();
  };
  const insert = (before: string, after = '') => {
    const element = area.current,
      start = element?.selectionStart ?? draft.content.body.length,
      end = element?.selectionEnd ?? start;
    patch({
      body:
        draft.content.body.slice(0, start) +
        before +
        draft.content.body.slice(start, end) +
        after +
        draft.content.body.slice(end),
    });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + before.length, end + before.length);
    });
  };
  return (
    <Dialog open onOpenChange={(v) => !v && close()}>
      <DialogPortal>
        <DialogOverlay className="dialog-overlay" />
        <DialogContent className="recorder">
          <header className="drawer-header">
            <div>
              <p className="eyebrow">{episode ? 'MOMENTS & MARGINS' : 'AFTER THE JOURNEY'}</p>
              <DialogTitle className="font-editorial text-2xl">
                {episode ? '留下这一集的余韵' : '故事落幕之后'}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted mt-1">
                {subjectTitle} · {note ? '编辑记录' : '新记录'}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button variant="ghost" aria-label="关闭记录页">
                <X size={20} />
              </Button>
            </DialogClose>
          </header>
          <div className="drawer-scroll">
            <section className="episode-heading">
              <span className="issue">{episode ? `EP.${episode.sort}` : 'REVIEW'}</span>
              <div>
                <h2 className="font-editorial text-xl">
                  {episode
                    ? episode.name_cn || episode.name || `第 ${episode.sort} 话`
                    : subjectTitle}
                </h2>
                <p className="text-sm text-muted">
                  {episode?.air_date || '每一次感受，都可以不同。'}
                </p>
              </div>
              {episode && onWatched && (
                <Button
                  variant="outline"
                  className="ml-auto"
                  onClick={() => void onWatched().catch((e) => setHint(e.message))}
                >
                  {watched ? <Check size={16} /> : <Clock size={16} />}
                  {watched ? '已看' : '未看'}
                </Button>
              )}
            </section>
            {!draft.ready && (
              <div className="empty compact">
                {draft.error || '正在读取草稿……'}
                <Button variant="outline" onClick={() => void draft.retry().catch(() => {})}>
                  重试
                </Button>
                {draft.error && (
                  <Button
                    variant="ghost"
                    onClick={() => download('未提交草稿.json', draft.content)}
                  >
                    导出恢复内容
                  </Button>
                )}
              </div>
            )}
            <fieldset disabled={!draft.ready || busy} className="editor-fields">
              <section className="editor-section">
                <label className="note-title-label">
                  {episode ? '笔记标题' : '总评标题'}
                  <input
                    className="note-title-input"
                    aria-label={episode ? '笔记标题' : '总评标题'}
                    value={draft.content.title || ''}
                    maxLength={200}
                    placeholder={
                      episode ? '给这一集的感受起个标题（可选）' : '这部作品留给我的……（可选）'
                    }
                    onChange={(event) => patch({ title: event.target.value })}
                  />
                </label>
              </section>
              {episode ? (
                <section className="editor-section">
                  <h3>这一集，感觉如何？</h3>
                  <p className="text-sm text-muted mb-3">
                    默认不评价；再次点击已选项可取消，点击其他选项可切换。
                  </p>
                  <div className="feeling-picker" role="group" aria-label="单集观感">
                    {feelings.map((f, i) => (
                      <button
                        key={f.value}
                        aria-pressed={draft.content.feeling === f.value}
                        className={`feel feel-${i} ${draft.content.feeling === f.value ? 'selected' : ''}`}
                        onClick={() =>
                          patch({ feeling: draft.content.feeling === f.value ? null : f.value })
                        }
                      >
                        {draft.content.feeling === f.value && '✓ '}
                        {f.label}
                      </button>
                    ))}
                  </div>
                </section>
              ) : (
                <section className="editor-section">
                  <SubjectRating
                    onBusyChange={setRatingBusy}
                    subjectId={subjectId}
                    revision={tick}
                    onChanged={onSaved}
                    onRated={(score) => {
                      setRatingSnapshot(score);
                      setSpoiler(null);
                    }}
                  />
                  <p className="text-sm text-muted mt-2">
                    点击星星立即保存分数。保存文字不会重复打分，关闭编辑器也不会撤销已打分数。
                  </p>
                </section>
              )}
              <section className="editor-section">
                <div className="flex justify-between items-center">
                  <h3>{episode ? '随手记' : '整体感想'}</h3>
                  <Button variant="ghost" onClick={() => setPreview(!preview)}>
                    {preview ? <Pencil size={15} /> : <Eye size={15} />}
                    {preview ? '编辑' : '预览'}
                  </Button>
                </div>
                <div className="markdown-editor">
                  <div className="toolbar" aria-label="格式工具">
                    {[
                      { label: '加粗', icon: Bold, a: '**', b: '**' },
                      { label: '斜体', icon: Italic, a: '*', b: '*' },
                      { label: '下划线', icon: Underline, a: '<u>', b: '</u>' },
                      { label: '删除线', icon: Strikethrough, a: '~~', b: '~~' },
                      { label: '剧透遮罩', icon: EyeOff, a: '||', b: '||' },
                    ].map((t) => (
                      <button
                        key={t.label}
                        title={t.label}
                        aria-label={t.label}
                        onClick={() => {
                          setPreview(false);
                          insert(t.a, t.b);
                        }}
                      >
                        <t.icon size={16} />
                      </button>
                    ))}
                    {episode && (
                      <>
                        <label className="timestamp">
                          <Clock size={14} />
                          <input
                            aria-label="插入时间戳"
                            value={stamp}
                            onChange={(e) => setStamp(e.target.value)}
                          />
                        </label>
                        <button
                          onClick={() => {
                            const time = normalizeTimestamp(stamp);
                            if (time) {
                              insert(`[${time}] `);
                              setStamp(time);
                            } else setHint('可以输入 1235、12：35 或 1:02:03。');
                          }}
                          aria-label="插入时间戳"
                        >
                          <Plus size={16} />
                        </button>
                      </>
                    )}
                  </div>
                  {preview ? (
                    <div className="preview">
                      <NoteBody body={draft.content.body || '还没有正文。'} />
                    </div>
                  ) : (
                    <textarea
                      ref={area}
                      value={draft.content.body}
                      onChange={(e) => patch({ body: e.target.value })}
                      placeholder={
                        episode
                          ? '这集的演出……\n比如 12:35 的长镜头，比台词更能传达离别。'
                          : '这部作品最终留给我的，是……'
                      }
                      aria-label="感想正文"
                      maxLength={100000}
                    />
                  )}
                  <p className="editor-hint">
                    Markdown · **加粗** · ~~删除~~ · ||剧透|| · &lt;u&gt;下划线&lt;/u&gt;
                  </p>
                </div>
              </section>
              {episode && (
                <section className="editor-section">
                  <div className="flex items-center justify-between">
                    <h3>
                      名场面<span className="optional">一句话即可，时间可不填</span>
                    </h3>
                    <Button
                      variant="ghost"
                      disabled={draft.content.scenes.length >= 50}
                      onClick={() =>
                        patch({ scenes: [...draft.content.scenes, { time: '', text: '' }] })
                      }
                    >
                      <Plus size={16} />
                      添加
                    </Button>
                  </div>
                  {draft.content.scenes.map((s, i) => (
                    <div className="scene-editor" key={i}>
                      <input
                        aria-label={`名场面 ${i + 1} 时间`}
                        value={s.time}
                        placeholder="时间可选"
                        maxLength={32}
                        onBlur={() => {
                          const normalized = normalizeTimestamp(s.time);
                          if (normalized !== null && normalized !== s.time)
                            patch({
                              scenes: draft.content.scenes.map((value, index) =>
                                index === i ? { ...value, time: normalized } : value,
                              ),
                            });
                        }}
                        onChange={(e) =>
                          patch({
                            scenes: draft.content.scenes.map((v, j) =>
                              j === i ? { ...v, time: e.target.value } : v,
                            ),
                          })
                        }
                      />
                      <input
                        aria-label={`名场面 ${i + 1} 描述`}
                        maxLength={1000}
                        placeholder="想记住的那个瞬间……"
                        value={s.text}
                        onChange={(e) =>
                          patch({
                            scenes: draft.content.scenes.map((v, j) =>
                              j === i ? { ...v, text: e.target.value } : v,
                            ),
                          })
                        }
                      />
                      <Button
                        variant="ghost"
                        aria-label="删除名场面"
                        onClick={() =>
                          patch({ scenes: draft.content.scenes.filter((_, j) => j !== i) })
                        }
                      >
                        <X size={16} />
                      </Button>
                    </div>
                  ))}
                </section>
              )}
              <Visibility
                isPublic={draft.content.isPublic}
                spoiler={spoiler}
                onChange={(p, s) => {
                  if (p !== draft.content.isPublic) patch({ isPublic: p });
                  setSpoiler(s);
                }}
              />
            </fieldset>
            {(draft.error || hint) && (
              <p
                role={draft.error ? 'alert' : 'status'}
                className={draft.error ? 'alert' : 'text-sm text-muted'}
              >
                {draft.error || hint}
              </p>
            )}
            {draft.error && !draft.conflict && (
              <div className="flex gap-2 mt-3">
                <Button
                  variant="outline"
                  onClick={() => download('未提交草稿.json', draft.content)}
                >
                  导出本地草稿
                </Button>
                {draft.ready && (
                  <Button variant="outline" onClick={() => void draft.retry().catch(() => {})}>
                    重试保存草稿
                  </Button>
                )}
              </div>
            )}
            {draft.conflict && (
              <div className="flex gap-2 mt-3">
                <Button
                  variant="outline"
                  onClick={() => download('未提交草稿.json', draft.content)}
                >
                  <Download size={15} />
                  导出本地内容
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    void draft.loadServer();
                  }}
                >
                  读取服务器版本
                </Button>
              </div>
            )}
            <p className="footnote">
              {episode && '有感受内容并保存后，本集及同类此前集数会标记为已看。'}
              自动保存只更新草稿，公开版本需明确发布。
            </p>
            <section className="editor-section">
              <h3>{episode ? '本集记录时间线' : '整体感想记录'}</h3>
              <NoteList
                meaningfulOnly
                onDeleted={(id) => {
                  if (id === draft.note.current?.id) {
                    draft.discardRecovery();
                    onClose();
                  }
                }}
                subjectId={subjectId}
                episodeId={episode?.id}
                scope={scope}
                revision={tick}
                onChanged={() => {
                  setTick((n) => n + 1);
                  onSaved();
                }}
                onEdit={(n) => {
                  if (n.id !== draft.note.current?.id)
                    void draft
                      .close()
                      .catch(() => {})
                      .then(() => onEditHistory(n));
                }}
              />
            </section>
          </div>
          <footer className="drawer-footer">
            <div role="status" aria-live="polite">
              <span>{draft.status}</span>
              <small>Ctrl / ⌘ + Enter 保存记录</small>
            </div>
            <Button
              disabled={!draft.ready || busy || ratingBusy || draft.conflict}
              onClick={() => void submit()}
            >
              <Check size={16} />
              {busy ? '保存中…' : draft.content.isPublic ? '确认公开发布' : '保存记录'}
            </Button>
          </footer>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
