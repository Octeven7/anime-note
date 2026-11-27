import { createServer } from 'node:http';
import { searchCatalog, getSubject, storeBundle, InputError } from './catalog.mjs';
import { UpstreamError } from './bangumi.mjs';
import {
  ServiceError,
  object,
  createNote,
  getNote,
  saveDraft,
  publishNote,
  mutateNote,
  noteHistory,
  listNotes,
  listTrash,
  listCollections,
  notebookSummary,
  publicImpressions,
  progress,
  setCollection,
  setEpisode,
  ratingHistory,
  addRating,
} from './personal.mjs';
import { exportPersonal, restorePersonal } from './backup.mjs';
import { autoBackup } from './auto-backup.mjs';
import { calendarService } from './calendar.mjs';
import { posterService, posterTiming } from './posters.mjs';
import { refreshDetail, refreshSections } from './detail-refresh.mjs';

const MAX_BODY = 4096;
async function readJson(req, limit = 512 * 1024) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw new InputError('需要 application/json');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) {
      req.resume();
      throw new ServiceError(413, '请求体过大');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) || '{}',
    );
  } catch {
    throw new InputError('无效 JSON 或 UTF-8');
  }
}
export function createApp({ db, client, port = 3001, posterOptions, backupDirectory }) {
  const backups = autoBackup(db, { directory: backupDirectory });
  const inFlight = new Map();
  const calendar = calendarService(db, client);
  const poster = posterService(db, posterOptions);
  const send = (res, status, data) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(data));
  };
  const server = createServer(
    { requestTimeout: 15000, headersTimeout: 10000 },
    async (req, res) => {
      try {
        const host = req.headers.host;
        const localPort = req.socket.localPort;
        if (![`127.0.0.1:${localPort}`, `localhost:${localPort}`].includes(host)) {
          send(res, 403, { error: '仅允许本机访问' });
          return;
        }
        const webPort = Number(process.env.WEB_PORT || 5173);
        if (
          req.headers.origin &&
          ![
            `http://127.0.0.1:${webPort}`,
            `http://localhost:${webPort}`,
            `http://127.0.0.1:${localPort}`,
          ].includes(req.headers.origin)
        ) {
          send(res, 403, { error: '不允许的请求来源' });
          return;
        }
        const url = new URL(req.url, `http://${host}`);
        if (req.method === 'GET' && url.pathname === '/api/posters/diagnostics') {
          send(res, 200, poster.diagnostics());
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/posters/prefetch') {
          const body = await readJson(req, MAX_BODY);
          object(body, ['ids']);
          if (
            !Array.isArray(body.ids) ||
            body.ids.length > 25 ||
            body.ids.some((id) => !Number.isSafeInteger(id) || id < 1)
          )
            throw new InputError('海报预取需要最多25个作品编号');
          void Promise.allSettled(
            [...new Set(body.ids)].slice(0, 4).map((id) => poster(id, { priority: false })),
          );
          send(res, 202, { queued: true });
          return;
        }
        const posterMatch = url.pathname.match(/^\/api\/posters\/([1-9]\d{0,9})$/);
        if (req.method === 'GET' && posterMatch) {
          try {
            const controller = new AbortController();
            res.once('close', () => {
              if (!res.writableEnded) controller.abort();
            });
            const image = await poster(Number(posterMatch[1]), { signal: controller.signal });
            if (!image) {
              send(res, 404, { error: '海报不存在' });
              return;
            }
            res.writeHead(req.headers['if-none-match'] === image.etag ? 304 : 200, {
              'Content-Type': image.type,
              'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
              'X-Content-Type-Options': 'nosniff',
              'X-Poster-Cache': image.cache,
              ETag: image.etag,
              'Server-Timing': posterTiming(image.timing),
            });
            res.end(
              req.headers['if-none-match'] === image.etag
                ? undefined
                : Buffer.from(image.base64, 'base64'),
            );
          } catch (error) {
            if (res.destroyed) return;
            if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
            res.setHeader('X-Poster-Status', error.code || 'network_error');
            res.setHeader('Server-Timing', posterTiming(error.timing));
            send(res, error.status === 499 ? 503 : error.status || 502, {
              error: '海报暂不可用',
              code: error.code || 'network_error',
            });
          }
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/calendar') {
          send(res, 200, await calendar(url.searchParams));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/me/collections') {
          send(res, 200, listCollections(db, url.searchParams));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/me/trash') {
          send(res, 200, listTrash(db, url.searchParams));
          return;
        }
        if (url.pathname === '/api/me/notes') {
          if (req.method === 'GET') {
            send(res, 200, listNotes(db, url.searchParams));
            return;
          }
          if (req.method === 'POST') {
            send(res, 201, createNote(db, await readJson(req)));
            return;
          }
        }
        const note = url.pathname.match(
          /^\/api\/me\/notes\/([A-Za-z0-9_-]+)(?:\/(draft|publish|unpublish|history|restore))?$/,
        );
        if (note) {
          const [, id, action] = note;
          if (req.method === 'GET' && !action) {
            send(res, 200, getNote(db, id));
            return;
          }
          if (req.method === 'GET' && action === 'history') {
            send(res, 200, { items: noteHistory(db, id) });
            return;
          }
          if (req.method === 'PUT' && action === 'draft') {
            send(res, 200, saveDraft(db, id, await readJson(req)));
            return;
          }
          if (req.method === 'POST' && action === 'publish') {
            send(res, 200, publishNote(db, id, await readJson(req)));
            return;
          }
          if (req.method === 'POST' && ['unpublish', 'restore'].includes(action)) {
            send(res, 200, mutateNote(db, id, action, await readJson(req)));
            return;
          }
          if (req.method === 'DELETE' && !action) {
            send(res, 200, mutateNote(db, id, 'delete', await readJson(req)));
            return;
          }
        }
        const personalSubject = url.pathname.match(
          /^\/api\/me\/subjects\/([A-Za-z0-9_-]+)\/(progress|collection|ratings|notebook)(?:\/([A-Za-z0-9_-]+))?$/,
        );
        if (personalSubject && !personalSubject[3]) {
          const [, id, action] = personalSubject;
          if (req.method === 'GET' && action === 'notebook') {
            send(res, 200, notebookSummary(db, id));
            return;
          }
          if (req.method === 'GET' && action === 'progress') {
            send(res, 200, progress(db, id));
            return;
          }
          if (req.method === 'PUT' && action === 'collection') {
            send(res, 200, setCollection(db, id, await readJson(req)));
            return;
          }
          if (req.method === 'GET' && action === 'ratings') {
            send(res, 200, ratingHistory(db, id));
            return;
          }
          if (req.method === 'POST' && action === 'ratings') {
            send(res, 201, addRating(db, id, await readJson(req)));
            return;
          }
        }
        const watched = url.pathname.match(
          /^\/api\/me\/subjects\/([A-Za-z0-9_-]+)\/episodes\/([A-Za-z0-9_-]+)$/,
        );
        if (req.method === 'PUT' && watched) {
          send(res, 200, setEpisode(db, watched[1], watched[2], await readJson(req)));
          return;
        }
        const impressions = url.pathname.match(/^\/api\/catalog\/([A-Za-z0-9_-]+)\/impressions$/);
        if (req.method === 'GET' && impressions) {
          send(res, 200, publicImpressions(db, impressions[1], url.searchParams));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/me/backup/status') {
          send(res, 200, backups.status());
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/me/backup') {
          res.setHeader('Content-Disposition', 'attachment; filename="paper-screen-personal.json"');
          send(res, 200, exportPersonal(db));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/me/backup/restore') {
          const payload = await readJson(req, 16 * 1024 * 1024);
          object(payload, ['backup', 'dryRun']);
          if (payload.dryRun !== undefined && typeof payload.dryRun !== 'boolean')
            throw new InputError('dryRun 必须为布尔值');
          send(res, 200, restorePersonal(db, payload.backup, { dryRun: payload.dryRun ?? false }));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/health') {
          send(res, 200, {
            status: 'ok',
            database: 'sqlite',
            schemaVersion: db.prepare('SELECT MAX(version) version FROM schema_migrations').get()
              .version,
            catalogCount: db.prepare('SELECT count(*) AS n FROM subjects').get().n,
            searchableCount: db.prepare('SELECT count(*) AS n FROM subjects WHERE nsfw=0').get().n,
            detailCount: db
              .prepare('SELECT count(*) AS n FROM source_records WHERE detail_complete=1')
              .get().n,
            lastImport:
              db
                .prepare(
                  'SELECT source,started_at,finished_at,processed,error FROM import_runs ORDER BY started_at DESC LIMIT 1',
                )
                .get() || null,
          });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/catalog') {
          send(res, 200, searchCatalog(db, url.searchParams));
          return;
        }
        const detail = url.pathname.match(/^\/api\/catalog\/(subject_[a-f0-9-]+)$/);
        if (req.method === 'GET' && detail) {
          const item = getSubject(db, detail[1]);
          send(res, item ? 200 : 404, item || { error: '本地资料库中没有该作品' });
          return;
        }
        const importing = url.pathname.match(/^\/api\/integrations\/bangumi\/subjects\/(\d+)$/);
        const refreshing = url.pathname.match(
          /^\/api\/integrations\/bangumi\/subjects\/(\d+)\/refresh$/,
        );
        if (req.method === 'POST' && refreshing) {
          const payload = await readJson(req, MAX_BODY);
          if (
            !payload ||
            Array.isArray(payload) ||
            Object.keys(payload).some((key) => key !== 'section') ||
            !['all', ...refreshSections].includes(payload.section)
          )
            throw new InputError('无效刷新范围');
          const bangumiId = Number(refreshing[1]);
          if (!Number.isSafeInteger(bangumiId) || bangumiId < 1)
            throw new InputError('无效 Bangumi ID');
          const key = 'refresh:' + bangumiId + ':' + payload.section;
          if (!inFlight.has(key))
            inFlight.set(
              key,
              refreshDetail(db, client, bangumiId, payload.section).finally(() =>
                inFlight.delete(key),
              ),
            );
          send(res, 200, await inFlight.get(key));
          return;
        }
        if (req.method === 'POST' && importing) {
          const payload = await readJson(req, MAX_BODY);
          if (
            !payload ||
            typeof payload !== 'object' ||
            Array.isArray(payload) ||
            Object.keys(payload).some((k) => k !== 'refresh') ||
            (payload.refresh !== undefined && typeof payload.refresh !== 'boolean')
          )
            throw new InputError('只接受可选的 refresh 布尔值');
          const bangumiId = Number(importing[1]);
          if (!Number.isSafeInteger(bangumiId) || bangumiId < 1)
            throw new InputError('无效 Bangumi ID');
          const cached = db
            .prepare(
              'SELECT s.id,r.fetched_at,r.detail_complete FROM subjects s LEFT JOIN source_records r ON r.subject_id=s.id WHERE s.bangumi_id=?',
            )
            .get(bangumiId);
          if (
            cached?.detail_complete &&
            !payload.refresh &&
            Date.now() - Date.parse(cached.fetched_at) < 86400000
          ) {
            send(res, 200, { item: getSubject(db, cached.id), cached: true, stale: false });
            return;
          }
          try {
            if (!inFlight.has(bangumiId))
              inFlight.set(
                bangumiId,
                client
                  .subjectBundle(bangumiId)
                  .then((bundle) => storeBundle(db, bundle))
                  .finally(() => inFlight.delete(bangumiId)),
              );
            const id = await inFlight.get(bangumiId);
            send(res, 200, { item: getSubject(db, id), cached: false, stale: false });
          } catch (e) {
            if (cached?.detail_complete) {
              send(res, 200, {
                item: getSubject(db, cached.id),
                cached: true,
                stale: true,
                warning: '上游暂时不可用，已返回本地缓存',
              });
            } else throw e;
          }
          return;
        }
        send(res, 404, { error: '接口不存在' });
      } catch (error) {
        const status =
          error instanceof ServiceError
            ? error.status
            : error instanceof InputError
              ? 400
              : error instanceof UpstreamError
                ? 502
                : 500;
        if (status === 500) console.error('API error:', error.message);
        send(res, status, {
          error: status === 500 ? '服务器内部错误' : error.message,
          ...(error instanceof UpstreamError ? { upstreamStatus: error.upstreamStatus } : {}),
        });
      }
    },
  );
  server.on('listening', backups.start);
  server.on('close', () => {
    backups.close();
    poster.close();
  });
  return server;
}
