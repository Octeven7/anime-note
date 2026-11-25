import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './database.mjs';
import { storeBundle } from './catalog.mjs';
import {
  createNote,
  getNote,
  saveDraft,
  publishNote,
  mutateNote,
  noteHistory,
  listNotes,
  publicImpressions,
  setCollection,
  setEpisode,
  progress,
  addRating,
  ratingHistory,
} from './personal.mjs';
import { exportPersonal, restorePersonal } from './backup.mjs';

function setup() {
  const db = openDatabase(':memory:');
  const sid = storeBundle(db, {
    subject: { id: 1, type: 2, name: '测试动画' },
    episodes: [{ id: 10, sort: 1, type: 0, name: '第一集' }],
    characters: [],
    persons: [],
  });
  return { db, sid, eid: 'bgm-episode-10' };
}
const p = (query = '') => new URLSearchParams(query);

test('有单集感受的草稿保存即联动已看，无内容不改进度，重复保存不重复事件', () => {
  const { db, sid, eid } = setup();
  try {
    for (const [id, sort] of [
      [11, 2],
      [12, 3],
    ])
      db.prepare('INSERT INTO episodes VALUES(?,?,?,?,?,?,?,?,?)').run(
        `bgm-episode-${id}`,
        sid,
        id,
        sort,
        0,
        '章节',
        '',
        null,
        '{}',
      );
    let note = createNote(db, { subjectId: sid, episodeId: 'bgm-episode-12', scope: 'episode' });
    assert.equal(progress(db, sid).episodes.length, 0);
    note = saveDraft(db, note.id, {
      expectedVersion: note.version,
      title: '演出细节',
      body: '一个长镜头',
      scenes: [
        { time: '1：02：03', text: '转场' },
        { time: '', text: '无时间也能记录' },
      ],
    });
    assert.equal(note.draft.scenes[0].time, '1:02:03');
    assert.equal(progress(db, sid).episodes.filter((ep) => ep.watched).length, 3);
    assert.equal(progress(db, sid).history.length, 3);
    publishNote(db, note.id, { expectedVersion: note.version });
    assert.equal(progress(db, sid).history.length, 3);
    assert.equal(listNotes(db, p('q=演出细节')).total, 1);
    const index = listNotes(db, p('view=index')).items[0];
    assert.equal(index.draft.title, '演出细节');
    assert.equal(index.draft.body, '');
    assert.equal(getNote(db, note.id).draft.body, '一个长镜头');
  } finally {
    db.close();
  }
});

test('独立打分不创建总评，文字保存不重复打分，旧总评快照和标题可备份恢复', () => {
  const { db, sid } = setup(),
    target = openDatabase(':memory:');
  try {
    addRating(db, sid, { score: 8 });
    assert.equal(listNotes(db, p()).total, 0);
    let note = createNote(db, {
      subjectId: sid,
      scope: 'overall',
      title: '故事的余韵',
      body: '第一遍的感想',
    });
    note = publishNote(db, note.id, { expectedVersion: note.version });
    assert.equal(note.published.score, 8);
    addRating(db, sid, { score: 6 });
    note = saveDraft(db, note.id, { expectedVersion: note.version, body: '只修改文字' });
    note = publishNote(db, note.id, { expectedVersion: note.version });
    assert.equal(note.published.score, 8);
    assert.equal(ratingHistory(db, sid).items.length, 2);
    assert.equal(ratingHistory(db, sid).current.score, 6);
    addRating(db, sid, { score: 9 });
    note = publishNote(db, note.id, { expectedVersion: note.version, ratingSnapshot: 9 });
    assert.equal(note.published.score, 9);
    assert.equal(ratingHistory(db, sid).items.length, 3);
    restorePersonal(target, exportPersonal(db));
    assert.equal(getNote(target, note.id).draft.title, '故事的余韵');
    assert.equal(noteHistory(target, note.id)[0].score, 9);
    const old = exportPersonal(db);
    old.version = 1;
    old.data.drafts.forEach((d) => delete d.title);
    old.data.revisions.forEach((r) => {
      delete r.title;
      delete r.score_snapshot;
    });
    const legacy = openDatabase(':memory:');
    try {
      restorePersonal(legacy, old);
      assert.equal(getNote(legacy, note.id).draft.title, '');
    } finally {
      legacy.close();
    }
  } finally {
    db.close();
    target.close();
  }
});

test('标记第N集时补齐此前同类章节，取消只影响本集，重复请求不重复记事件', () => {
  const { db, sid, eid } = setup();
  try {
    for (const [id, sort, type] of [
      [11, 2, 0],
      [12, 3, 0],
      [13, 4, 0],
      [14, 1, 1],
    ]) {
      db.prepare('INSERT INTO episodes VALUES(?,?,?,?,?,?,?,?,?)').run(
        `bgm-episode-${id}`,
        sid,
        id,
        sort,
        type,
        '章节',
        '',
        null,
        '{}',
      );
    }
    let result = setEpisode(db, sid, 'bgm-episode-12', { watched: true });
    assert.deepEqual(
      result.episodes
        .filter((ep) => ep.watched)
        .map((ep) => ep.episode_id)
        .sort(),
      [eid, 'bgm-episode-11', 'bgm-episode-12'].sort(),
    );
    assert.equal(result.history.length, 3);
    assert.equal(setEpisode(db, sid, 'bgm-episode-12', { watched: true }).history.length, 3);
    result = setEpisode(db, sid, 'bgm-episode-11', { watched: false });
    assert.equal(result.episodes.find((ep) => ep.episode_id === 'bgm-episode-12').watched, true);
    assert.equal(result.episodes.find((ep) => ep.episode_id === eid).watched, true);
    setEpisode(db, sid, 'bgm-episode-14', { watched: true });
    assert.ok(!progress(db, sid).episodes.some((ep) => ep.episode_id === 'bgm-episode-13'));
  } finally {
    db.close();
  }
});

test('所有笔记列表默认排除误触空草稿与空名场面，保留仅观感记录', () => {
  const { db, sid, eid } = setup();
  try {
    const target = { subjectId: sid, episodeId: eid, scope: 'episode' };
    createNote(db, target);
    createNote(db, {
      ...target,
      body: '  \n',
      isPublic: true,
      scenes: [{ time: '00:00', text: '  ' }],
    });
    createNote(db, { ...target, feeling: 'good' });
    assert.equal(listNotes(db, p()).total, 1);
    assert.equal(listNotes(db, p('meaningful=true')).total, 1);
    assert.equal(listNotes(db, p('meaningful=false')).total, 3);
  } finally {
    db.close();
  }
});

test('多次记录、幂等重试、空白草稿和按正文检索', () => {
  const { db, sid, eid } = setup();
  try {
    const input = {
      subjectId: sid,
      episodeId: eid,
      scope: 'episode',
      idempotencyKey: 'request-one',
    };
    const a = createNote(db, input);
    assert.equal(a.draft.isPublic, false);
    assert.equal(a.published, null);
    assert.equal(createNote(db, input).id, a.id);
    assert.throws(
      () => createNote(db, { ...input, body: 'different' }),
      (e) => e.status === 409,
    );
    assert.throws(() => publishNote(db, a.id, { expectedVersion: a.version }));
    const b = createNote(db, {
      ...input,
      idempotencyKey: 'request-two',
      body: '长镜头的演出',
      scenes: [{ time: '12:35', text: '很好的留白' }],
    });
    assert.notEqual(a.id, b.id);
    assert.equal(listNotes(db, p('q=留白')).total, 1);
    assert.equal(listNotes(db, p('q=长镜头')).total, 1);
    assert.throws(() => createNote(db, { ...input, body: null }));
    assert.throws(() => createNote(db, { ...input, userId: 'other' }));
  } finally {
    db.close();
  }
});
test('公开区只展示已发布版本，修改后须再次声明，剧透默认不返回正文', () => {
  const { db, sid, eid } = setup();
  try {
    let n = createNote(db, {
      subjectId: sid,
      episodeId: eid,
      scope: 'episode',
      body: '旧内容',
      isPublic: true,
    });
    assert.equal(publicImpressions(db, sid, p()).total, 0);
    assert.throws(() => publishNote(db, n.id, { expectedVersion: n.version }), /剧透/);
    n = publishNote(db, n.id, { expectedVersion: n.version, spoiler: false });
    assert.equal(publicImpressions(db, sid, p()).items[0].body, '旧内容');
    const staleVersion = n.version;
    n = saveDraft(db, n.id, { expectedVersion: n.version, body: '结局的秘密' });
    assert.equal(publicImpressions(db, sid, p()).items[0].body, '旧内容');
    assert.equal(n.draft.spoiler, null);
    assert.throws(
      () => saveDraft(db, n.id, { expectedVersion: staleVersion, body: '覆盖' }),
      (e) => e.status === 409,
    );
    assert.throws(() => publishNote(db, n.id, { expectedVersion: n.version }), /剧透/);
    n = publishNote(db, n.id, { expectedVersion: n.version, spoiler: true });
    const hidden = publicImpressions(db, sid, p()).items[0];
    assert.equal(hidden.hidden, true);
    assert.ok(!Object.hasOwn(hidden, 'body'));
    assert.ok(!Object.hasOwn(hidden, 'scenes'));
    assert.equal(publicImpressions(db, sid, p('includeSpoilers=true')).items[0].body, '结局的秘密');
    assert.equal(noteHistory(db, n.id).length, 2);
    assert.equal(noteHistory(db, n.id)[1].body, '旧内容');
    n = mutateNote(db, n.id, 'unpublish', { expectedVersion: n.version });
    assert.equal(publicImpressions(db, sid, p()).total, 0);
    assert.equal(n.draft.isPublic, false);
  } finally {
    db.close();
  }
});
test('删除可恢复、恢复默认私密，不能读取或改写其他用户笔记', () => {
  const { db, sid, eid } = setup();
  try {
    let n = createNote(db, {
      subjectId: sid,
      episodeId: eid,
      scope: 'episode',
      body: '感受',
      isPublic: true,
    });
    n = publishNote(db, n.id, { expectedVersion: n.version, spoiler: false });
    const deletion = mutateNote(db, n.id, 'delete', { expectedVersion: n.version });
    assert.throws(
      () => getNote(db, n.id),
      (e) => e.status === 404,
    );
    assert.equal(publicImpressions(db, sid, p()).total, 0);
    n = mutateNote(db, n.id, 'restore', { expectedVersion: deletion.version });
    assert.equal(n.draft.body, '感受');
    assert.equal(n.draft.isPublic, false);
    assert.equal(n.published, null);
    db.prepare("INSERT INTO users VALUES('other','他人',?)").run(new Date().toISOString());
    db.prepare("UPDATE notes SET user_id='other' WHERE id=?").run(n.id);
    assert.throws(
      () => getNote(db, n.id),
      (e) => e.status === 404,
    );
    assert.throws(
      () => noteHistory(db, n.id),
      (e) => e.status === 404,
    );
    assert.throws(
      () => saveDraft(db, n.id, { expectedVersion: n.version, body: '入侵' }),
      (e) => e.status === 404,
    );
  } finally {
    db.close();
  }
});
test('收藏、跳集和重看事件独立，整体评分取最近一次且不依赖单集观感', () => {
  const { db, sid, eid } = setup();
  try {
    setCollection(db, sid, { status: 'doing' });
    assert.equal(progress(db, sid).collection.status, 'doing');
    setEpisode(db, sid, eid, { watched: true });
    setEpisode(db, sid, eid, { watched: true });
    assert.equal(progress(db, sid).history.length, 1);
    setEpisode(db, sid, eid, { watched: false });
    assert.equal(progress(db, sid).history.length, 1);
    setEpisode(db, sid, eid, { watched: true });
    assert.equal(progress(db, sid).history.length, 2);
    createNote(db, { subjectId: sid, episodeId: eid, scope: 'episode', feeling: 'masterpiece' });
    assert.equal(ratingHistory(db, sid).current, null);
    addRating(db, sid, { score: 8 });
    addRating(db, sid, { score: 9 });
    assert.equal(ratingHistory(db, sid).current.score, 9);
    assert.equal(ratingHistory(db, sid).items.length, 2);
    createNote(db, { subjectId: sid, scope: 'overall', body: '完结后的感想' });
    assert.equal(ratingHistory(db, sid).current.score, 9);
    assert.throws(() => addRating(db, sid, { score: 10.5 }));
    assert.throws(() => setEpisode(db, sid, 'missing', { watched: true }));
    setCollection(db, sid, { status: null });
    assert.equal(progress(db, sid).collection, null);
    assert.equal(progress(db, sid).episodes.length, 1);
  } finally {
    db.close();
  }
});
test('备份可在空库恢复，引用重映射，预检无写入，恢复私密且可重复', () => {
  const { db, sid, eid } = setup(),
    target = openDatabase(':memory:');
  try {
    let n = createNote(db, {
      subjectId: sid,
      episodeId: eid,
      scope: 'episode',
      body: '备份内容',
      isPublic: true,
    });
    n = publishNote(db, n.id, { expectedVersion: n.version, spoiler: true });
    setEpisode(db, sid, eid, { watched: true });
    setCollection(db, sid, { status: 'doing' });
    addRating(db, sid, { score: 7 });
    addRating(db, sid, { score: 9 });
    const backup = JSON.parse(JSON.stringify(exportPersonal(db)));
    assert.equal(restorePersonal(target, backup, { dryRun: true }).dryRun, true);
    assert.equal(target.prepare('SELECT count(*) n FROM subjects').get().n, 0);
    restorePersonal(target, backup);
    const restored = getNote(target, n.id);
    assert.notEqual(restored.subjectId, sid);
    assert.equal(restored.draft.body, '备份内容');
    assert.equal(restored.draft.isPublic, false);
    assert.equal(restored.published, null);
    assert.equal(noteHistory(target, n.id).length, 1);
    assert.equal(publicImpressions(target, restored.subjectId, p()).total, 0);
    assert.equal(ratingHistory(target, restored.subjectId).current.score, 9);
    assert.equal(progress(target, restored.subjectId).history.length, 1);
    restorePersonal(target, backup);
    assert.equal(listNotes(target, p()).total, 1);
    const edited = saveDraft(target, n.id, {
      expectedVersion: restored.version,
      body: '恢复后修改',
    });
    assert.throws(
      () => restorePersonal(target, backup),
      (e) => e.status === 409,
    );
    assert.equal(getNote(target, n.id).draft.body, '恢复后修改');
    assert.equal(edited.version, restored.version + 1);
  } finally {
    db.close();
    target.close();
  }
});
test('恶意或损坏备份完全回滚、不覆盖其他用户数据', () => {
  const { db, sid, eid } = setup(),
    target = openDatabase(':memory:');
  try {
    const n = createNote(db, { subjectId: sid, episodeId: eid, scope: 'episode', body: '秘密' });
    const backup = JSON.parse(JSON.stringify(exportPersonal(db)));
    backup.data.drafts[0].scenes = 'not JSON';
    assert.throws(() => restorePersonal(target, backup));
    assert.equal(target.prepare('SELECT count(*) n FROM subjects').get().n, 0);
    const valid = exportPersonal(db);
    valid.data.notes[0].user_id = 'other';
    assert.throws(() => restorePersonal(target, valid));
    assert.equal(target.prepare('SELECT count(*) n FROM notes').get().n, 0);
    assert.equal(getNote(db, n.id).draft.body, '秘密');
  } finally {
    db.close();
    target.close();
  }
});
