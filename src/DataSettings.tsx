import { useState } from 'react';
import { Download, Upload, RotateCcw, Database } from 'lucide-react';
import { api, useRemote, download, formatDate } from './lib/api';
import { legacyBackup, readLegacyBrowser } from './lib/legacy';
import type { Note as LegacyNote } from './data';
import type { Page, Subject } from './types';
import { Button } from './components/ui/button';
import { ErrorNotice, Empty } from './components/common';
interface Trash {
  id: string;
  subjectId: string;
  subjectTitle: string;
  episodeSort: number | null;
  preview: string;
  scope: string;
  episodeId: string | null;
  deletedAt: string;
  version: number;
}
export default function DataSettings({
  revision,
  onChanged,
}: {
  revision: number;
  onChanged: () => void;
}) {
  const [page, setPage] = useState(1),
    [backup, setBackup] = useState<unknown>(null),
    [plan, setPlan] = useState<{
      message: string;
      notes: number;
      inserted: Record<string, number>;
    } | null>(null),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [filename, setFilename] = useState('');
  const health = useRemote<{
    catalogCount: number;
    searchableCount: number;
    schemaVersion: number;
  }>(String(revision), (signal) => api('/api/health', { signal }));
  const trash = useRemote<Page<Trash>>(`${revision}:${page}`, (signal) =>
    api(`/api/me/trash?page=${page}`, { signal }),
  );
  let hasLegacy = false;
  try {
    hasLegacy = readLegacyBrowser().hasData;
  } catch {}
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function prepare(value: unknown, name: string) {
    let selected = value as { format?: string };
    if (selected?.format !== 'paper-screen-personal') {
      const result = await api<{ item: Subject }>('/api/integrations/bangumi/subjects/400602', {
        method: 'POST',
        body: {},
      });
      const old = value as { legacyDrafts?: { key: string; value: LegacyNote }[] };
      selected = await legacyBackup(
        value,
        result.item,
        Array.isArray(old.legacyDrafts) ? old.legacyDrafts : [],
      );
    }
    setBackup(selected);
    setFilename(name);
    setPlan(null);
    setMessage('文件已读取。先预检，确认后再恢复；恢复内容默认为私密。');
  }
  const restore = async (dryRun: boolean) => {
    const result = await api<{ message: string; notes: number; inserted: Record<string, number> }>(
      '/api/me/backup/restore',
      { method: 'POST', body: { backup, dryRun } },
    );
    if (dryRun) setPlan(result);
    else {
      if (filename === '当前浏览器旧版手账')
        try {
          localStorage.setItem('paper-screen:legacy-migrated-at', new Date().toISOString());
        } catch {}
      setMessage(result.message);
      setPlan(null);
      setBackup(null);
      onChanged();
      trash.reload();
    }
  };
  return (
    <section>
      <div className="page-heading">
        <p className="eyebrow text-brand">KEEP YOUR STORIES</p>
        <h1>把手账好好留下。</h1>
        <p>导出、恢复、回收站和旧版记录迁移，都在这里。</p>
      </div>
      {error && <ErrorNotice message={error} />}
      {message && (
        <p className="inline-notice" role="status">
          {message}
        </p>
      )}
      <section className="settings-section">
        <h2>
          <Database size={19} />
          本机资料库
        </h2>
        {health.error ? (
          <ErrorNotice message={health.error} retry={health.reload} />
        ) : (
          <p>
            已收录 {health.data?.catalogCount.toLocaleString() || '…'} 部动画，默认可检索{' '}
            {health.data?.searchableCount.toLocaleString() || '…'} 部。数据库结构 v
            {health.data?.schemaVersion || '…'}。
          </p>
        )}
        <p className="text-sm text-muted">
          个人记录保存在当前电脑的 SQLite
          数据库；切换浏览器仍可读取同一数据库。跨设备访问与账号登录尚未开放。
        </p>
      </section>
      <section className="settings-section">
        <h2>
          <Download size={19} />
          备份与恢复
        </h2>
        <p className="text-sm text-muted">
          JSON
          备份包含私密正文、草稿和历史，不包含账号令牌或整套番剧资料。恢复不会覆盖已有不同内容。
        </p>
        <div className="settings-actions">
          <Button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                download(
                  `纸间放映-个人备份-${new Date().toISOString().slice(0, 10)}.json`,
                  await api('/api/me/backup'),
                );
                setMessage('备份已生成，请妥善保管下载文件。');
              })
            }
          >
            <Download size={16} />
            下载个人备份
          </Button>
          <label className="button button-outline">
            <Upload size={16} />
            选择备份文件
            <input
              className="sr-only"
              aria-label="选择备份文件"
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                setBackup(null);
                setPlan(null);
                if (file)
                  void action(async () => {
                    if (file.size > 16 * 1024 * 1024)
                      throw new Error('网页恢复最多16MiB，更大的文件请使用命令行。');
                    await prepare(JSON.parse(await file.text()), file.name);
                  });
              }}
            />
          </label>
        </div>
        {backup !== null && (
          <div className="restore-plan">
            <p>待恢复：{filename}</p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void action(() => restore(true))}
            >
              预检恢复
            </Button>
            {plan && (
              <>
                <p>
                  预检通过：{plan.notes} 条笔记；新增记录{' '}
                  {Object.values(plan.inserted).reduce((a, b) => a + b, 0)} 条。尚未写入。
                </p>
                <Button disabled={busy} onClick={() => void action(() => restore(false))}>
                  确认恢复为私密记录
                </Button>
              </>
            )}
          </div>
        )}
      </section>
      {hasLegacy && (
        <section className="settings-section">
          <h2>检测到这个浏览器的旧版手账</h2>
          <p>
            旧版演示记录对应《葬送的芙莉莲》。迁移会按真实正篇集数匹配，保留原始浏览器数据，且不会自动公开；演示放送表的虚构“已看”状态不会迁移。
          </p>
          <div className="settings-actions">
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const legacy = readLegacyBrowser();
                  const value = legacy.library;
                  const result = await api<{ item: Subject }>(
                    '/api/integrations/bangumi/subjects/400602',
                    { method: 'POST', body: {} },
                  );
                  const drafts = legacy.drafts;
                  const converted = await legacyBackup(value, result.item, drafts);
                  setBackup(converted);
                  setFilename('当前浏览器旧版手账');
                  setPlan(null);
                  setMessage('已生成迁移方案，请在上方预检后确认恢复。');
                })
              }
            >
              准备迁移旧记录
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                download('旧版手账原始备份.json', {
                  ...readLegacyBrowser().library,
                  legacyDrafts: readLegacyBrowser().drafts,
                })
              }
            >
              导出旧版原始数据
            </Button>
          </div>
        </section>
      )}
      <section className="settings-section">
        <h2>
          <RotateCcw size={19} />
          回收站
        </h2>
        <p className="text-sm text-muted">删除的记录保留在这里。恢复后为私密状态，不会重新公开。</p>
        {trash.error ? (
          <ErrorNotice message={trash.error} retry={trash.reload} />
        ) : trash.data?.items.length ? (
          trash.data.items.map((row) => (
            <div className="trash-row" key={row.id}>
              <div>
                <a href={`#/subject/${row.subjectId}`}>
                  {row.subjectTitle} ·{' '}
                  {row.scope === 'overall' ? '整体感想' : `第 ${row.episodeSort ?? '?'} 话`}
                </a>
                <p className="text-sm text-muted">删除于 {formatDate(row.deletedAt)}</p>
              </div>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api(`/api/me/notes/${row.id}/restore`, {
                      method: 'POST',
                      body: { expectedVersion: row.version },
                    });
                    setMessage('记录已恢复为私密。');
                    onChanged();
                  })
                }
              >
                恢复
              </Button>
            </div>
          ))
        ) : (
          <Empty title="回收站是空的" />
        )}
        <div className="pagination">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
            上一页
          </Button>
          <span>{trash.data?.total || 0} 条</span>
          <Button
            variant="ghost"
            disabled={page * 20 >= (trash.data?.total || 0)}
            onClick={() => setPage((n) => n + 1)}
          >
            下一页
          </Button>
        </div>
      </section>
    </section>
  );
}
