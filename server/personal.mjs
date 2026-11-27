import { randomUUID, createHash } from 'node:crypto';
import { transaction } from './database.mjs';
import { InputError, serialize } from './catalog.mjs';
import { normalizeTimestamp } from './time.mjs';

// Local-only actor. Never accept a browser-supplied user ID as authentication.
export const ACTOR = 'local-user';
export class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const now = () => new Date().toISOString();
const feelings = ['awful', 'weak', 'fair', 'good', 'masterpiece'];
const trimWhitespace = (value) =>
  `trim(${value},char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))`;
const meaningfulDraft = `(${trimWhitespace('d.title')}<>'' OR ${trimWhitespace('d.body')}<>'' OR d.feeling IS NOT NULL OR EXISTS(SELECT 1 FROM json_each(d.scenes) scene WHERE ${trimWhitespace("json_extract(scene.value,'$.text')")}<>'') OR n.published_revision_id IS NOT NULL)`;
const revisionScore = (alias) =>
  `COALESCE(${alias}.score_snapshot,(SELECT o.score FROM overall_ratings o JOIN note_revisions scored ON scored.id=o.revision_id WHERE scored.note_id=${alias}.note_id AND scored.version<=${alias}.version ORDER BY scored.version DESC LIMIT 1))`;
export function object(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw new InputError('请求包含无效字段');
  return value;
}
export function string(value, label, max = 200) {
  if (typeof value !== 'string' || !value.length || value.length > max)
    throw new InputError(`${label}格式错误`);
  return value;
}
function subject(db, id) {
  string(id, '作品ID');
  if (!db.prepare('SELECT id FROM subjects WHERE id=?').get(id))
    throw new ServiceError(404, '作品不存在');
}
function episode(db, subjectId, episodeId) {
  string(episodeId, '章节ID');
  if (!db.prepare('SELECT id FROM episodes WHERE id=? AND subject_id=?').get(episodeId, subjectId))
    throw new InputError('章节不属于该作品，或尚未导入章节资料');
}
function ownNote(db, id, includeDeleted = false) {
  const n = db.prepare('SELECT * FROM notes WHERE id=? AND user_id=?').get(id, ACTOR);
  if (!n || (!includeDeleted && n.deleted_at)) throw new ServiceError(404, '笔记不存在');
  return n;
}
function version(n, value) {
  if (!Number.isInteger(value) || value < 0) throw new InputError('必须提供 expectedVersion');
  if (n.version !== value) throw new ServiceError(409, '笔记已被其他页面修改，请重新读取后保存');
}
export function validateContent(value, scope) {
  const title = value.title ?? '';
  if (typeof title !== 'string' || title.length > 200) throw new InputError('标题最多200字');
  const body = value.body === undefined ? '' : value.body,
    feeling = value.feeling ?? null,
    scenes = value.scenes === undefined ? [] : value.scenes,
    isPublic = value.isPublic === undefined ? false : value.isPublic;
  if (typeof body !== 'string' || body.length > 100000) throw new InputError('正文最多 100000 字');
  if (feeling !== null && !feelings.includes(feeling)) throw new InputError('无效观感');
  if (scope === 'overall' && feeling !== null) throw new InputError('整体评价不使用单集观感');
  if (typeof isPublic !== 'boolean') throw new InputError('isPublic 必须是布尔值');
  if (!Array.isArray(scenes) || scenes.length > 50) throw new InputError('名场面最多 50 条');
  for (const s of scenes) {
    object(s, ['time', 'text']);
    if (
      typeof s.time !== 'string' ||
      normalizeTimestamp(s.time) === null ||
      typeof s.text !== 'string' ||
      s.text.length > 1000
    )
      throw new InputError('名场面需要有效时间和最多 1000 字描述');
  }
  if (scope === 'overall' && scenes.length) throw new InputError('整体评价不使用单集名场面');
  return {
    title,
    body,
    feeling,
    scenes: scenes.map((s) => ({ ...s, time: normalizeTimestamp(s.time) })),
    isPublic,
  };
}
const serializeRevision = (r) =>
  r
    ? {
        id: r.id,
        version: r.version,
        body: r.body,
        title: r.title || '',
        feeling: r.feeling,
        scenes: JSON.parse(r.scenes),
        isPublic: !!r.is_public,
        spoiler: r.spoiler === null ? null : !!r.spoiler,
        createdAt: r.created_at,
        score: r.overall_score ?? null,
      }
    : null;
export function getNote(db, id) {
  const n = ownNote(db, id),
    d = db.prepare('SELECT * FROM note_drafts WHERE note_id=?').get(id);
  const p = n.published_revision_id
    ? db
        .prepare(
          `SELECT r.*,${revisionScore('r')} overall_score FROM note_revisions r WHERE r.id=? AND r.note_id=?`,
        )
        .get(n.published_revision_id, id)
    : null;
  const s = db.prepare('SELECT name,name_cn FROM subjects WHERE id=?').get(n.subject_id);
  const e = n.episode_id
    ? db.prepare('SELECT sort,name,name_cn,type FROM episodes WHERE id=?').get(n.episode_id)
    : null;
  return {
    id: n.id,
    subjectId: n.subject_id,
    subjectTitle: s.name_cn || s.name,
    episodeId: n.episode_id,
    episode: e,
    scope: n.scope,
    version: n.version,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
    draft: d
      ? {
          body: d.body,
          title: d.title || '',
          feeling: d.feeling,
          scenes: JSON.parse(d.scenes),
          isPublic: !!d.is_public,
          spoiler: null,
          updatedAt: d.updated_at,
        }
      : null,
    published: serializeRevision(p),
  };
}
function writeDraft(db, id, c, t) {
  db.prepare(
    'INSERT INTO note_drafts(note_id,body,feeling,scenes,is_public,updated_at,title) VALUES(?,?,?,?,?,?,?) ON CONFLICT(note_id) DO UPDATE SET body=excluded.body,feeling=excluded.feeling,scenes=excluded.scenes,is_public=excluded.is_public,updated_at=excluded.updated_at,title=excluded.title',
  ).run(id, c.body, c.feeling, JSON.stringify(c.scenes), c.isPublic ? 1 : 0, t, c.title);
}
export function createNote(db, input) {
  object(input, [
    'subjectId',
    'episodeId',
    'scope',
    'body',
    'title',
    'feeling',
    'scenes',
    'isPublic',
    'idempotencyKey',
  ]);
  if (!['episode', 'overall'].includes(input.scope))
    throw new InputError('scope 必须为 episode 或 overall');
  subject(db, input.subjectId);
  if (input.scope === 'episode') episode(db, input.subjectId, input.episodeId);
  else if (input.episodeId !== undefined && input.episodeId !== null)
    throw new InputError('整体评价不能绑定单集');
  const c = validateContent(input, input.scope),
    key = input.idempotencyKey;
  if (key !== undefined) string(key, '幂等键', 128);
  const hash = createHash('sha256')
    .update(JSON.stringify([input.subjectId, input.episodeId ?? null, input.scope, c]))
    .digest('hex');
  return transaction(db, () => {
    if (key) {
      const previous = db
        .prepare('SELECT * FROM idempotency_keys WHERE user_id=? AND key=?')
        .get(ACTOR, key);
      if (previous) {
        if (previous.request_hash !== hash) throw new ServiceError(409, '幂等键已用于其他内容');
        return getNote(db, previous.resource_id);
      }
    }
    const id = `note_${randomUUID()}`,
      t = now();
    db.prepare(
      'INSERT INTO notes(id,user_id,subject_id,episode_id,scope,created_at,version,updated_at) VALUES(?,?,?,?,?,?,1,?)',
    ).run(id, ACTOR, input.subjectId, input.episodeId ?? null, input.scope, t, t);
    writeDraft(db, id, c, t);
    if (
      input.scope === 'episode' &&
      (c.body.trim() || c.feeling || c.scenes.some((s) => s.text.trim()))
    )
      markEpisodes(db, input.subjectId, input.episodeId, true);
    if (key) db.prepare('INSERT INTO idempotency_keys VALUES(?,?,?,?)').run(ACTOR, key, hash, id);
    return getNote(db, id);
  });
}
export function saveDraft(db, id, input) {
  object(input, ['expectedVersion', 'title', 'body', 'feeling', 'scenes', 'isPublic']);
  return transaction(db, () => {
    const n = ownNote(db, id);
    version(n, input.expectedVersion);
    const old = getNote(db, id).draft;
    const c = validateContent({ ...old, ...input }, n.scope),
      t = now();
    writeDraft(db, id, c, t);
    db.prepare('UPDATE notes SET version=version+1,updated_at=? WHERE id=?').run(t, id);
    if (
      n.scope === 'episode' &&
      (c.body.trim() || c.feeling || c.scenes.some((s) => s.text.trim()))
    )
      markEpisodes(db, n.subject_id, n.episode_id, true);
    return getNote(db, id);
  });
}
export function publishNote(db, id, input) {
  object(input, ['expectedVersion', 'spoiler', 'score', 'ratingSnapshot']);
  return transaction(db, () => {
    const n = ownNote(db, id);
    version(n, input.expectedVersion);
    const c = getNote(db, id).draft;
    if (!c) throw new InputError('没有可发布的草稿');
    if (
      input.score !== undefined &&
      (n.scope !== 'overall' ||
        !Number.isInteger(input.score) ||
        input.score < 1 ||
        input.score > 10)
    )
      throw new InputError('只有整体评价可附带1至10整数评分');
    if (
      !c.title.trim() &&
      !c.body.trim() &&
      !c.feeling &&
      !c.scenes.some((s) => s.text.trim()) &&
      input.score === undefined
    )
      throw new InputError('不能发布空白记录');
    if (c.scenes.some((s) => !s.text.trim())) throw new InputError('名场面描述不能为空');
    if (c.isPublic && typeof input.spoiler !== 'boolean')
      throw new InputError('公开发布必须重新声明有无剧透');
    if (input.spoiler !== undefined && typeof input.spoiler !== 'boolean')
      throw new InputError('spoiler 必须是布尔值');
    if (
      input.ratingSnapshot !== undefined &&
      (n.scope !== 'overall' ||
        !Number.isInteger(input.ratingSnapshot) ||
        input.ratingSnapshot < 1 ||
        input.ratingSnapshot > 10)
    )
      throw new InputError('评分快照须为1至10整数');
    const previousScore = getNote(db, id).published?.score;
    const snapshot =
      n.scope === 'overall'
        ? (input.score ??
          input.ratingSnapshot ??
          previousScore ??
          ratingHistory(db, n.subject_id).current?.score ??
          null)
        : null;
    const rid = `revision_${randomUUID()}`,
      t = now(),
      next = n.version + 1;
    db.prepare(
      "INSERT INTO note_revisions(id,note_id,version,state,body,feeling,scenes,is_public,spoiler,created_at,title,score_snapshot) VALUES(?,?,?,'published',?,?,?,?,?,?,?,?)",
    ).run(
      rid,
      id,
      next,
      c.body,
      c.feeling,
      JSON.stringify(c.scenes),
      c.isPublic ? 1 : 0,
      c.isPublic ? (input.spoiler ? 1 : 0) : null,
      t,
      c.title,
      snapshot,
    );
    db.prepare('UPDATE notes SET version=?,updated_at=?,published_revision_id=? WHERE id=?').run(
      next,
      t,
      rid,
      id,
    );
    if (input.score !== undefined) insertRating(db, n.subject_id, input.score, rid);
    if (n.scope === 'episode') markEpisodes(db, n.subject_id, n.episode_id, true);
    return getNote(db, id);
  });
}
export function mutateNote(db, id, action, input) {
  object(input, ['expectedVersion']);
  return transaction(db, () => {
    const n = ownNote(db, id, action === 'restore');
    version(n, input.expectedVersion);
    const t = now();
    if (action === 'delete')
      db.prepare(
        'UPDATE notes SET deleted_at=?,version=version+1,updated_at=?,published_revision_id=NULL WHERE id=?',
      ).run(t, t, id);
    else if (action === 'restore') {
      if (!n.deleted_at) throw new InputError('笔记未删除');
      db.prepare(
        'UPDATE notes SET deleted_at=NULL,version=version+1,updated_at=?,published_revision_id=NULL WHERE id=?',
      ).run(t, id);
      db.prepare('UPDATE note_drafts SET is_public=0,updated_at=? WHERE note_id=?').run(t, id);
    } else if (action === 'unpublish') {
      db.prepare(
        'UPDATE notes SET published_revision_id=NULL,version=version+1,updated_at=? WHERE id=?',
      ).run(t, id);
      db.prepare('UPDATE note_drafts SET is_public=0,updated_at=? WHERE note_id=?').run(t, id);
    } else throw new InputError('无效操作');
    return action === 'delete' ? { id, deleted: true, version: n.version + 1 } : getNote(db, id);
  });
}
export function noteHistory(db, id) {
  ownNote(db, id);
  return db
    .prepare(
      `SELECT r.*,${revisionScore('r')} overall_score FROM note_revisions r WHERE note_id=? ORDER BY version DESC`,
    )
    .all(id)
    .map(serializeRevision);
}
function pagination(p) {
  const page = Number(p.get('page') || 1),
    limit = Number(p.get('limit') || 20);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 100000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new InputError('分页参数无效');
  return { page, limit };
}
export function listNotes(db, p) {
  const { page, limit } = pagination(p),
    clauses = ['n.user_id=?', 'n.deleted_at IS NULL'],
    args = [ACTOR];
  if (p.get('meaningful') !== 'false') clauses.push(meaningfulDraft);
  for (const [param, column] of [
    ['subjectId', 'subject_id'],
    ['episodeId', 'episode_id'],
    ['scope', 'scope'],
  ])
    if (p.has(param)) {
      clauses.push(`n.${column}=?`);
      args.push(string(p.get(param), param));
    }
  if (p.has('q')) {
    const q = p.get('q');
    if (q.length > 100) throw new InputError('搜索词最多100字');
    clauses.push(
      "(d.title LIKE ? ESCAPE '\\' OR d.body LIKE ? ESCAPE '\\' OR d.scenes LIKE ? ESCAPE '\\')",
    );
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    args.push(pattern, pattern, pattern);
  }
  const where = clauses.join(' AND '),
    join = 'notes n JOIN note_drafts d ON d.note_id=n.id';
  if (p.get('view') === 'subjects') {
    const total = db
      .prepare(`SELECT count(DISTINCT n.subject_id) n FROM ${join} WHERE ${where}`)
      .get(...args).n;
    const items = db
      .prepare(
        `SELECT s.id,s.bangumi_id,s.name,s.name_cn,s.image_url,
        count(*) AS noteCount,max(n.updated_at) AS latestNoteAt
       FROM ${join} JOIN subjects s ON s.id=n.subject_id
       WHERE ${where}
       GROUP BY s.id
       ORDER BY latestNoteAt DESC,s.id
       LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, (page - 1) * limit);
    return { items, total, page, limit };
  }
  const total = db.prepare(`SELECT count(*) n FROM ${join} WHERE ${where}`).get(...args).n;
  const items = db
    .prepare(
      `SELECT n.id FROM ${join} WHERE ${where} ORDER BY n.updated_at DESC,n.id LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, (page - 1) * limit)
    .map((n) => {
      const note = getNote(db, n.id);
      if (p.get('view') !== 'index') return note;
      const title =
        note.draft.title.trim() ||
        note.draft.body
          .split('\n')
          .find((line) => line.trim())
          ?.replace(/[#*_~|<>]/g, '')
          .trim()
          .slice(0, 80) ||
        `${note.subjectTitle} · ${note.scope === 'overall' ? '整体评价' : `第 ${note.episode?.sort ?? '?'} 话感想`}`;
      return { ...note, draft: { ...note.draft, title, body: '', scenes: [] }, published: null };
    });
  return { items, total, page, limit };
}
export function listTrash(db, p) {
  const { page, limit } = pagination(p);
  const total = db
    .prepare('SELECT count(*) n FROM notes WHERE user_id=? AND deleted_at IS NOT NULL')
    .get(ACTOR).n;
  const items = db
    .prepare(
      "SELECT n.id,n.subject_id AS subjectId,n.episode_id AS episodeId,n.scope,n.deleted_at AS deletedAt,n.version,COALESCE(NULLIF(s.name_cn,''),s.name) AS subjectTitle,e.sort AS episodeSort,substr(COALESCE(d.body,''),1,80) AS preview FROM notes n JOIN subjects s ON s.id=n.subject_id LEFT JOIN episodes e ON e.id=n.episode_id LEFT JOIN note_drafts d ON d.note_id=n.id WHERE n.user_id=? AND n.deleted_at IS NOT NULL ORDER BY n.deleted_at DESC,n.id LIMIT ? OFFSET ?",
    )
    .all(ACTOR, limit, (page - 1) * limit);
  return { items, total, page, limit };
}
export function publicImpressions(db, subjectId, p) {
  subject(db, subjectId);
  const { page, limit } = pagination(p);
  const show = p.get('includeSpoilers') === 'true';
  const where =
    'n.subject_id=? AND n.deleted_at IS NULL AND r.is_public=1' +
    (p.has('noteId') ? ' AND n.id=?' : '');
  const args = p.has('noteId') ? [subjectId, p.get('noteId')] : [subjectId];
  const join =
    'notes n JOIN note_revisions r ON r.id=n.published_revision_id JOIN users u ON u.id=n.user_id';
  const total = db.prepare(`SELECT count(*) n FROM ${join} WHERE ${where}`).get(...args).n;
  const items = db
    .prepare(
      `SELECT n.id,n.scope,n.episode_id,r.*,${revisionScore('r')} overall_score,u.display_name FROM ${join} WHERE ${where} ORDER BY r.created_at DESC,r.rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, (page - 1) * limit)
    .map((r) => ({
      noteId: r.note_id,
      scope: r.scope,
      episodeId: r.episode_id,
      author: r.display_name,
      version: r.version,
      createdAt: r.created_at,
      spoiler: !!r.spoiler,
      hidden: !!r.spoiler && !show,
      ...(!r.spoiler || show
        ? {
            body: r.body,
            title: r.title || '',
            score: r.overall_score ?? null,
            feeling: r.feeling,
            scenes: JSON.parse(r.scenes),
          }
        : {}),
    }));
  return { items, total, page, limit };
}
export function progress(db, subjectId) {
  subject(db, subjectId);
  return {
    subjectId,
    collection:
      db
        .prepare('SELECT status,updated_at FROM collections WHERE user_id=? AND subject_id=?')
        .get(ACTOR, subjectId) || null,
    episodes: db
      .prepare(
        'SELECT episode_id,watched,updated_at FROM episode_progress WHERE user_id=? AND subject_id=?',
      )
      .all(ACTOR, subjectId)
      .map((e) => ({ ...e, watched: !!e.watched })),
    history: db
      .prepare(
        'SELECT id,episode_id,watched_at FROM watch_events WHERE user_id=? AND subject_id=? ORDER BY watched_at DESC,rowid DESC LIMIT 100',
      )
      .all(ACTOR, subjectId),
  };
}
export function setCollection(db, subjectId, input) {
  object(input, ['status']);
  subject(db, subjectId);
  if (!['wish', 'doing', 'done', 'hold', 'dropped', null].includes(input.status))
    throw new InputError('无效收藏状态');
  if (input.status === null)
    db.prepare('DELETE FROM collections WHERE user_id=? AND subject_id=?').run(ACTOR, subjectId);
  else
    db.prepare(
      'INSERT INTO collections VALUES(?,?,?,?) ON CONFLICT(user_id,subject_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at',
    ).run(ACTOR, subjectId, input.status, now());
  return progress(db, subjectId);
}
export function setEpisode(db, subjectId, episodeId, input) {
  object(input, ['watched']);
  subject(db, subjectId);
  episode(db, subjectId, episodeId);
  if (typeof input.watched !== 'boolean') throw new InputError('watched 必须是布尔值');
  return transaction(db, () => {
    markEpisodes(db, subjectId, episodeId, input.watched, { manual: true });
    return progress(db, subjectId);
  });
}
function markEpisodes(db, subjectId, episodeId, watched, { manual = false } = {}) {
  const target = db.prepare('SELECT type,sort FROM episodes WHERE id=?').get(episodeId);
  // Numbering is independent for the main story, specials, OP/ED, etc.
  const targets = watched
    ? db
        .prepare(
          'SELECT id FROM episodes WHERE subject_id=? AND type=? AND sort<=? ORDER BY sort,id',
        )
        .all(subjectId, target.type, target.sort)
    : [{ id: episodeId }];
  const t = now();
  const update = db.prepare(
    'INSERT INTO episode_progress VALUES(?,?,?,?,?) ON CONFLICT(user_id,episode_id) DO UPDATE SET watched=excluded.watched,updated_at=excluded.updated_at',
  );
  const lookup = db.prepare(
    'SELECT watched FROM episode_progress WHERE user_id=? AND episode_id=?',
  );
  for (const ep of targets) {
    const previous = lookup.get(ACTOR, ep.id);
    if (watched && previous?.watched === 0 && !(manual && ep.id === episodeId)) continue;
    if (previous?.watched === Number(watched)) continue;
    update.run(ACTOR, subjectId, ep.id, watched ? 1 : 0, t);
    if (watched && !previous?.watched)
      db.prepare('INSERT INTO watch_events VALUES(?,?,?,?,?)').run(
        `watch_${randomUUID()}`,
        ACTOR,
        subjectId,
        ep.id,
        t,
      );
  }
}
export function ratingHistory(db, subjectId) {
  subject(db, subjectId);
  const items = db
    .prepare(
      'SELECT id,score,rated_at FROM overall_ratings WHERE user_id=? AND subject_id=? ORDER BY rated_at DESC,rowid DESC',
    )
    .all(ACTOR, subjectId);
  return { subjectId, current: items[0] || null, items };
}
function insertRating(db, subjectId, score, revisionId = null) {
  const previous = db
    .prepare('SELECT MAX(rated_at) t FROM overall_ratings WHERE user_id=? AND subject_id=?')
    .get(ACTOR, subjectId).t;
  let t = now();
  if (previous && t <= previous) t = new Date(Date.parse(previous) + 1).toISOString();
  db.prepare(
    'INSERT INTO overall_ratings(id,user_id,subject_id,score,rated_at,revision_id) VALUES(?,?,?,?,?,?)',
  ).run(`rating_${randomUUID()}`, ACTOR, subjectId, score, t, revisionId);
}
export function addRating(db, subjectId, input) {
  object(input, ['score']);
  subject(db, subjectId);
  if (!Number.isInteger(input.score) || input.score < 1 || input.score > 10)
    throw new InputError('整体评分须为1至10整数');
  return transaction(db, () => {
    insertRating(db, subjectId, input.score);
    return ratingHistory(db, subjectId);
  });
}
export function listCollections(db, p) {
  const { page, limit } = pagination(p),
    status = p.get('status');
  if (status && !['wish', 'doing', 'done', 'hold', 'dropped'].includes(status))
    throw new InputError('无效收藏状态');
  const where = 'c.user_id=?' + (status ? ' AND c.status=?' : '');
  const args = status ? [ACTOR, status] : [ACTOR];
  const total = db.prepare(`SELECT count(*) n FROM collections c WHERE ${where}`).get(...args).n;
  const items = db
    .prepare(
      `SELECT s.*,c.status,c.updated_at collectionUpdatedAt FROM collections c JOIN subjects s ON s.id=c.subject_id WHERE ${where} ORDER BY c.updated_at DESC,c.subject_id LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, (page - 1) * limit)
    .map((s) => ({
      ...serialize(db, s),
      watched: db
        .prepare(
          'SELECT count(*) n FROM episode_progress WHERE user_id=? AND subject_id=? AND watched=1',
        )
        .get(ACTOR, s.id).n,
      myScore: ratingHistory(db, s.id).current?.score ?? null,
    }));
  return { items, total, page, limit };
}
export function notebookSummary(db, subjectId) {
  subject(db, subjectId);
  const episodes = db
    .prepare(
      `SELECT n.episode_id episodeId,count(*) noteCount,max(COALESCE(r.spoiler,0)) spoiler FROM notes n JOIN note_drafts d ON d.note_id=n.id LEFT JOIN note_revisions r ON r.id=n.published_revision_id WHERE n.user_id=? AND n.subject_id=? AND n.scope='episode' AND n.deleted_at IS NULL AND ${meaningfulDraft} GROUP BY n.episode_id`,
    )
    .all(ACTOR, subjectId)
    .map((e) => ({
      ...e,
      spoiler: !!e.spoiler,
      feeling:
        db
          .prepare(
            'SELECT d.feeling FROM notes n JOIN note_drafts d ON d.note_id=n.id WHERE n.user_id=? AND n.episode_id=? AND n.deleted_at IS NULL AND d.feeling IS NOT NULL ORDER BY n.updated_at DESC,n.id LIMIT 1',
          )
          .get(ACTOR, e.episodeId)?.feeling ?? null,
    }));
  return { episodes };
}
