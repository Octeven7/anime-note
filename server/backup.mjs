import { upsertSubject, InputError } from './catalog.mjs';
import { ACTOR, object, string, validateContent, ServiceError } from './personal.mjs';

const names = [
  'subjects',
  'episodes',
  'notes',
  'drafts',
  'revisions',
  'collections',
  'progress',
  'watches',
  'ratings',
];
export function exportPersonal(db) {
  db.exec('BEGIN');
  try {
    const notes = db.prepare('SELECT * FROM notes WHERE user_id=? ORDER BY id').all(ACTOR);
    const revisions = db
      .prepare(
        'SELECT r.* FROM note_revisions r JOIN notes n ON n.id=r.note_id WHERE n.user_id=? ORDER BY r.note_id,r.version',
      )
      .all(ACTOR);
    const drafts = db
      .prepare(
        'SELECT d.* FROM note_drafts d JOIN notes n ON n.id=d.note_id WHERE n.user_id=? ORDER BY d.note_id',
      )
      .all(ACTOR);
    const collections = db.prepare('SELECT * FROM collections WHERE user_id=?').all(ACTOR),
      progress = db.prepare('SELECT * FROM episode_progress WHERE user_id=?').all(ACTOR),
      watches = db.prepare('SELECT * FROM watch_events WHERE user_id=? ORDER BY rowid').all(ACTOR),
      ratings = db
        .prepare('SELECT * FROM overall_ratings WHERE user_id=? ORDER BY rated_at,rowid')
        .all(ACTOR);
    const subjectIds = new Set(
      [...notes, ...collections, ...progress, ...watches, ...ratings].map((r) => r.subject_id),
    );
    const episodeIds = new Set(
      [...notes, ...progress, ...watches].map((r) => r.episode_id).filter(Boolean),
    );
    const subjects = [...subjectIds].map((id) =>
      db
        .prepare('SELECT id,bangumi_id,name,name_cn,air_date,nsfw FROM subjects WHERE id=?')
        .get(id),
    );
    const episodes = [...episodeIds].map((id) =>
      db
        .prepare(
          'SELECT id,subject_id,bangumi_id,sort,type,name,name_cn,air_date FROM episodes WHERE id=?',
        )
        .get(id),
    );
    const result = {
      format: 'paper-screen-personal',
      version: 2,
      exportedAt: new Date().toISOString(),
      owner: ACTOR,
      data: {
        subjects,
        episodes,
        notes,
        drafts,
        revisions,
        collections,
        progress,
        watches,
        ratings,
      },
    };
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const isInt = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
function check(condition, message) {
  if (!condition) throw new InputError(`备份无效：${message}`);
}
function date(v, nullable = false) {
  check(
    (nullable && v === null) ||
      (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v))),
    '时间格式',
  );
}
function id(v) {
  return string(v, '备份ID', 200);
}
function fields(row, list) {
  object(row, list);
  check(
    list.every((k) => Object.hasOwn(row, k)),
    '字段缺失',
  );
}
function sameRow(a, b) {
  return Object.keys(b).every((k) => a[k] === b[k]);
}

export function restorePersonal(db, backup, { dryRun = false } = {}) {
  object(backup, ['format', 'version', 'exportedAt', 'owner', 'data']);
  check(
    backup.format === 'paper-screen-personal' && [1, 2].includes(backup.version),
    '不支持的格式或版本',
  );
  id(backup.owner);
  date(backup.exportedAt);
  object(backup.data, names);
  const data = { ...backup.data };
  if (backup.version === 1) {
    if (Array.isArray(data.drafts)) data.drafts = data.drafts.map((d) => ({ title: '', ...d }));
    if (Array.isArray(data.revisions))
      data.revisions = data.revisions.map((r) => ({ title: '', score_snapshot: null, ...r }));
  }
  let total = 0;
  for (const name of names) {
    check(Array.isArray(data[name]), `缺少 ${name}`);
    total += data[name].length;
  }
  check(total <= 100000, '记录数超过100000');
  const subjectMap = new Map(),
    episodeMap = new Map(),
    noteMap = new Map();
  const seen = new Map();
  function unique(table, key) {
    if (!seen.has(table)) seen.set(table, new Set());
    check(!seen.get(table).has(key), `${table}存在重复记录`);
    seen.get(table).add(key);
  }
  const counts = {};
  function merge(table, row, keys) {
    const key = JSON.stringify(keys.map((k) => row[k]));
    unique(table, key);
    const existing = db
      .prepare(`SELECT * FROM ${table} WHERE ${keys.map((k) => `${k}=?`).join(' AND ')}`)
      .get(...keys.map((k) => row[k]));
    if (existing) {
      if (!sameRow(existing, row))
        throw new ServiceError(409, `恢复冲突：${table} 已有不同内容，未覆盖任何数据`);
      return;
    }
    const columns = Object.keys(row);
    db.prepare(
      `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
    ).run(...columns.map((k) => row[k]));
    counts[table] = (counts[table] || 0) + 1;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const s of data.subjects) {
      fields(s, ['id', 'bangumi_id', 'name', 'name_cn', 'air_date', 'nsfw']);
      id(s.id);
      check(isInt(s.bangumi_id, 1), '作品外部ID');
      string(s.name, '作品名', 1000);
      check(typeof s.name_cn === 'string' && s.name_cn.length <= 1000, '中文名');
      check(s.air_date === null || /^\d{4}-\d{2}-\d{2}$/.test(s.air_date), '首播日期');
      check([0, 1].includes(s.nsfw), '成人标志');
      unique('subjects', s.id);
      unique('subject-bangumi', s.bangumi_id);
      const existing = db.prepare('SELECT id FROM subjects WHERE bangumi_id=?').get(s.bangumi_id);
      const mapped =
        existing?.id ||
        upsertSubject(db, {
          id: s.bangumi_id,
          type: 2,
          name: s.name,
          name_cn: s.name_cn,
          date: s.air_date,
          nsfw: !!s.nsfw,
        });
      subjectMap.set(s.id, mapped);
    }
    const mappedSubject = (old) => {
      check(subjectMap.has(old), '缺少作品引用');
      return subjectMap.get(old);
    };
    for (const e of data.episodes) {
      fields(e, ['id', 'subject_id', 'bangumi_id', 'sort', 'type', 'name', 'name_cn', 'air_date']);
      id(e.id);
      unique('episode-source', e.id);
      check(
        isInt(e.bangumi_id, 1) &&
          typeof e.sort === 'number' &&
          Number.isFinite(e.sort) &&
          isInt(e.type),
        '章节编号',
      );
      check(
        typeof e.name === 'string' &&
          e.name.length <= 1000 &&
          typeof e.name_cn === 'string' &&
          e.name_cn.length <= 1000,
        '章节名称',
      );
      check(e.air_date === null || /^\d{4}-\d{2}-\d{2}$/.test(e.air_date), '章节日期');
      unique('episode-bangumi', e.bangumi_id);
      const sid = mappedSubject(e.subject_id),
        existing = db
          .prepare('SELECT id,subject_id FROM episodes WHERE bangumi_id=?')
          .get(e.bangumi_id);
      if (existing && existing.subject_id !== sid)
        throw new ServiceError(409, '章节在本地属于另一部作品，恢复已取消');
      const eid = existing?.id || `bgm-episode-${e.bangumi_id}`;
      episodeMap.set(e.id, eid);
      if (!existing)
        db.prepare('INSERT INTO episodes VALUES(?,?,?,?,?,?,?,?,?)').run(
          eid,
          sid,
          e.bangumi_id,
          e.sort,
          e.type,
          e.name,
          e.name_cn,
          e.air_date,
          JSON.stringify({
            id: e.bangumi_id,
            sort: e.sort,
            type: e.type,
            name: e.name,
            name_cn: e.name_cn,
            airdate: e.air_date,
          }),
        );
    }
    const mappedEpisode = (old, sid) => {
      check(episodeMap.has(old), '缺少章节引用');
      const eid = episodeMap.get(old);
      check(
        db.prepare('SELECT subject_id FROM episodes WHERE id=?').get(eid).subject_id === sid,
        '章节与作品不匹配',
      );
      return eid;
    };
    for (const n of data.notes) {
      fields(n, [
        'id',
        'user_id',
        'subject_id',
        'episode_id',
        'scope',
        'created_at',
        'deleted_at',
        'version',
        'updated_at',
        'published_revision_id',
      ]);
      id(n.id);
      check(n.user_id === backup.owner, '笔记所属用户不一致');
      check(['episode', 'overall'].includes(n.scope) && isInt(n.version, 1), '笔记类型或版本');
      date(n.created_at);
      date(n.updated_at);
      date(n.deleted_at, true);
      const sid = mappedSubject(n.subject_id);
      check(n.scope === 'episode' ? n.episode_id !== null : n.episode_id === null, '笔记集数');
      const ep = n.scope === 'episode' ? mappedEpisode(n.episode_id, sid) : null;
      const row = {
        ...n,
        user_id: ACTOR,
        subject_id: sid,
        episode_id: ep,
        published_revision_id: null,
      };
      merge('notes', row, ['id']);
      noteMap.set(n.id, row);
    }
    for (const d of data.drafts) {
      fields(d, ['note_id', 'title', 'body', 'feeling', 'scenes', 'is_public', 'updated_at']);
      check(noteMap.has(d.note_id), '草稿对应笔记不存在');
      date(d.updated_at);
      check([0, 1].includes(d.is_public), '草稿公开标志');
      let scenes;
      try {
        scenes = JSON.parse(d.scenes);
      } catch {
        throw new InputError('备份名场面不是JSON');
      }
      validateContent(
        { title: d.title, body: d.body, feeling: d.feeling, scenes, isPublic: !!d.is_public },
        noteMap.get(d.note_id).scope,
      );
      merge('note_drafts', { ...d, is_public: 0 }, ['note_id']);
    }
    check(data.drafts.length === data.notes.length, '每条笔记需要一个草稿');
    for (const r of data.revisions) {
      fields(r, [
        'id',
        'note_id',
        'version',
        'state',
        'title',
        'score_snapshot',
        'body',
        'feeling',
        'scenes',
        'is_public',
        'spoiler',
        'created_at',
      ]);
      id(r.id);
      check(
        r.score_snapshot === null || (isInt(r.score_snapshot, 1) && r.score_snapshot <= 10),
        '评分快照',
      );
      check(
        noteMap.has(r.note_id) &&
          r.state === 'published' &&
          isInt(r.version, 1) &&
          r.version <= noteMap.get(r.note_id).version,
        '笔记历史版本',
      );
      date(r.created_at);
      check(
        [0, 1].includes(r.is_public) &&
          [0, 1, null].includes(r.spoiler) &&
          (!r.is_public || r.spoiler !== null),
        '历史剧透声明',
      );
      let scenes;
      try {
        scenes = JSON.parse(r.scenes);
      } catch {
        throw new InputError('备份名场面不是JSON');
      }
      validateContent(
        { title: r.title, body: r.body, feeling: r.feeling, scenes, isPublic: !!r.is_public },
        noteMap.get(r.note_id).scope,
      );
      merge('note_revisions', r, ['id']);
    }
    for (const n of data.notes)
      if (n.published_revision_id !== null) {
        const r = db
          .prepare('SELECT note_id FROM note_revisions WHERE id=?')
          .get(n.published_revision_id);
        check(r?.note_id === n.id, '发布版本不属于笔记');
      }
    for (const c of data.collections) {
      fields(c, ['user_id', 'subject_id', 'status', 'updated_at']);
      check(
        c.user_id === backup.owner &&
          ['wish', 'doing', 'done', 'hold', 'dropped'].includes(c.status),
        '收藏状态或用户',
      );
      date(c.updated_at);
      merge('collections', { ...c, user_id: ACTOR, subject_id: mappedSubject(c.subject_id) }, [
        'user_id',
        'subject_id',
      ]);
    }
    for (const p of data.progress) {
      fields(p, ['user_id', 'subject_id', 'episode_id', 'watched', 'updated_at']);
      check(p.user_id === backup.owner && [0, 1].includes(p.watched), '进度状态或用户');
      date(p.updated_at);
      const sid = mappedSubject(p.subject_id);
      merge(
        'episode_progress',
        { ...p, user_id: ACTOR, subject_id: sid, episode_id: mappedEpisode(p.episode_id, sid) },
        ['user_id', 'episode_id'],
      );
    }
    for (const w of data.watches) {
      fields(w, ['id', 'user_id', 'subject_id', 'episode_id', 'watched_at']);
      id(w.id);
      check(w.user_id === backup.owner, '观看历史用户');
      date(w.watched_at);
      const sid = mappedSubject(w.subject_id);
      merge(
        'watch_events',
        { ...w, user_id: ACTOR, subject_id: sid, episode_id: mappedEpisode(w.episode_id, sid) },
        ['id'],
      );
    }
    for (const r of data.ratings) {
      fields(r, [
        'id',
        'user_id',
        'subject_id',
        'score',
        'rated_at',
        ...(Object.hasOwn(r, 'revision_id') ? ['revision_id'] : []),
      ]);
      id(r.id);
      check(r.user_id === backup.owner && isInt(r.score, 1) && r.score <= 10, '整体评分或用户');
      date(r.rated_at);
      const sid = mappedSubject(r.subject_id);
      if (r.revision_id !== undefined && r.revision_id !== null) {
        id(r.revision_id);
        const reference = db
          .prepare(
            'SELECT n.subject_id,n.scope FROM note_revisions r JOIN notes n ON n.id=r.note_id WHERE r.id=? AND n.user_id=?',
          )
          .get(r.revision_id, ACTOR);
        check(
          reference?.subject_id === sid && reference.scope === 'overall',
          '评分对应的总评版本无效',
        );
      }
      merge(
        'overall_ratings',
        { ...r, user_id: ACTOR, subject_id: sid, revision_id: r.revision_id ?? null },
        ['id'],
      );
    }
    db.exec(dryRun ? 'ROLLBACK' : 'COMMIT');
    return {
      dryRun,
      inserted: counts,
      notes: data.notes.length,
      restoredVisibility: 'private',
      message: dryRun ? '校验通过，未写入数据' : '恢复完成，笔记均保持私密；已有不同内容不会被覆盖',
    };
  } catch (error) {
    db.exec('ROLLBACK');
    if (error instanceof InputError || error instanceof ServiceError) throw error;
    throw new InputError('备份关联或数据约束校验失败，已回滚');
  }
}
