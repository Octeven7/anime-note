import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, transaction } from './database.mjs';
import { upsertSubject, searchCatalog, storeBundle, getSubject } from './catalog.mjs';
const raw = (id = 1) => ({
  id,
  type: 2,
  name: '葬送のフリーレン',
  name_cn: '葬送的芙莉莲',
  date: '2023-09-29',
  rating: { score: 9.1, total: 500 },
  infobox: [{ key: '别名', value: [{ v: 'Frieren' }] }],
  tags: [{ name: '奇幻' }, { name: '冒险' }],
});
test('详情优先使用明确总话数，未知值回退到归档，不以章节条数推算', () => {
  const db = openDatabase(':memory:');
  try {
    const id = upsertSubject(db, { ...raw(), infobox: [{ key: '话数', value: '*' }] });
    assert.equal(getSubject(db, id).totalEpisodes, null);
    db.prepare('INSERT INTO archive_infoboxes VALUES (?,?)').run(
      id,
      JSON.stringify([{ key: '话数', value: '12' }]),
    );
    assert.equal(getSubject(db, id).totalEpisodes, 12);
    upsertSubject(db, { ...raw(), infobox: [{ key: '话数', value: '13 话' }] });
    assert.equal(getSubject(db, id).totalEpisodes, 13);
    assert.equal(getSubject(db, id).episodes.length, 0);
  } finally {
    db.close();
  }
});
const search = (db, query) => {
  const params = new URLSearchParams(query);
  if (!params.has('minVotes')) params.set('minVotes', '0');
  return searchCatalog(db, params);
};

test('评分闭区间包含两端，接受一位小数，拒绝倒置范围与无效精度', () => {
  const db = openDatabase(':memory:');
  try {
    for (const [index, score] of [7.4, 7.5, 8, 8.1].entries())
      upsertSubject(db, { ...raw(index + 1), rating: { score, total: 100 } });
    assert.equal(search(db, 'minScore=7.5&maxScore=8.0').total, 2);
    assert.equal(search(db, 'minScore=8&maxScore=8').total, 1);
    assert.equal(search(db, 'maxScore=7.5').total, 2);
    for (const query of [
      'minScore=8&maxScore=7',
      'maxScore=10.1',
      'minScore=7.55',
      'maxScore=-1',
      'maxScore=abc',
    ])
      assert.throws(() => search(db, query));
  } finally {
    db.close();
  }
});

test('数据库迁移可重复打开，存储能在服务重启后恢复', () => {
  const dir = mkdtempSync(join(tmpdir(), 'anime-db-'));
  try {
    let db = openDatabase(join(dir, 'test.sqlite'));
    const id = transaction(db, () => upsertSubject(db, raw()));
    db.close();
    db = openDatabase(join(dir, 'test.sqlite'));
    assert.equal(getSubject(db, id).name_cn, '葬送的芙莉莲');
    assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get().n, 12);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('本地检索支持中文短词、FTS长词、别名、季度边界及标签 AND', () => {
  const db = openDatabase(':memory:');
  try {
    transaction(db, () => {
      upsertSubject(db, raw());
      upsertSubject(db, {
        ...raw(2),
        name_cn: '别的作品',
        name: 'Other',
        date: '2023-10-01',
        rating: { score: 6, total: 2 },
        infobox: [],
        tags: [],
      });
      upsertSubject(db, { ...raw(3), nsfw: true });
    });
    assert.equal(search(db, 'q=芙莉').total, 1);
    assert.equal(search(db, 'q=芙莉莲').total, 1);
    assert.equal(search(db, 'q=FRIEREN').total, 1);
    assert.equal(
      search(db, 'year=2023&quarter=3&tag=奇幻&tag=冒险&minScore=8&minVotes=100').total,
      1,
    );
    assert.equal(search(db, 'year=2023&quarter=4').total, 1);
    assert.equal(search(db, 'tag=奇幻&tag=不存在').total, 0);
    assert.equal(search(db, 'limit=1&page=2').items.length, 1);
    assert.equal(search(db, 'q=%25').total, 0);
    assert.equal(search(db, 'q=%27%20OR%201%3D1--').total, 0);
    assert.throws(() => search(db, 'quarter=1'));
    assert.throws(() => search(db, 'sort=DROP'));
    assert.throws(() => search(db, 'limit=1.2'));
  } finally {
    db.close();
  }
});
test('资料更新保持内部ID和笔记关联，整体分数不从单集观感推导', () => {
  const db = openDatabase(':memory:');
  try {
    const bundle = {
      subject: raw(),
      episodes: [{ id: 100, sort: 1, type: 0, name: '冒险结束' }],
      characters: [{ id: 10, name: '芙莉莲', actors: [{ id: 20, name: '种崎敦美' }] }],
      persons: [{ id: 30, name: 'MADHOUSE', relation: '动画制作' }],
    };
    const id = storeBundle(db, bundle);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO notes(id,user_id,subject_id,episode_id,scope,created_at,deleted_at) VALUES('note','local-user',?,'bgm-episode-100','episode',?,NULL)",
    ).run(id, now);
    db.prepare(
      "INSERT INTO note_revisions(id,note_id,version,state,body,feeling,scenes,is_public,spoiler,created_at) VALUES('revision','note',1,'published','很好','masterpiece','[]',0,NULL,?)",
    ).run(now);
    assert.equal(
      storeBundle(db, { ...bundle, subject: { ...raw(), name_cn: '更新后的名称' } }),
      id,
    );
    assert.equal(db.prepare('SELECT count(*) n FROM notes').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM overall_ratings').get().n, 0);
    assert.equal(getSubject(db, id).characters[0].actors[0].name, '种崎敦美');
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO note_revisions(id,note_id,version,state,body,feeling,scenes,is_public,spoiler,created_at) VALUES('bad','note',2,'published','泄露',NULL,'[]',1,NULL,?)",
        )
        .run(now),
    );
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO notes(id,user_id,subject_id,episode_id,scope,created_at,deleted_at) VALUES('wrong','local-user',?,'missing','episode',?,NULL)",
        )
        .run(id, now),
    );
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO overall_ratings(id,user_id,subject_id,score,rated_at) VALUES('score','local-user',?,11,?)",
        )
        .run(id, now),
    );
  } finally {
    db.close();
  }
});
test('归档补充不覆盖完整详情缓存，事务失败不会留下半份资料', () => {
  const db = openDatabase(':memory:');
  try {
    const id = storeBundle(db, { subject: raw(), episodes: [], characters: [], persons: [] });
    transaction(db, () => upsertSubject(db, { ...raw(), score: 9.2, rating: undefined }));
    assert.equal(getSubject(db, id).source.detailComplete, true);
    assert.throws(() =>
      transaction(db, () => {
        upsertSubject(db, raw(99));
        throw new Error('rollback');
      }),
    );
    assert.equal(db.prepare('SELECT count(*) n FROM subjects WHERE bangumi_id=99').get().n, 0);
  } finally {
    db.close();
  }
});
test('官方归档原始wiki和大小写重复标签可幂等导入', () => {
  const db = openDatabase(':memory:');
  try {
    const rawArchive = {
      ...raw(),
      infobox: '{{Infobox animanga/TVAnime}}',
      tags: [{ name: 'TV' }, { name: 'tv' }, { name: 'ＴＶ' }],
      meta_tags: ['TV'],
    };
    const id = transaction(db, () => upsertSubject(db, rawArchive));
    assert.equal(
      transaction(db, () => upsertSubject(db, rawArchive)),
      id,
    );
    assert.equal(search(db, 'tag=tv').total, 1);
    assert.deepEqual(getSubject(db, id).tags, ['tv']);
  } finally {
    db.close();
  }
});
