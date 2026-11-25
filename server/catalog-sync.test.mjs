import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, transaction } from './database.mjs';
import { upsertSubject, getSubject, searchCatalog } from './catalog.mjs';
import { repairCatalog, storeMetadata, syncMetadata, syncTag } from './catalog-sync.mjs';
import { tagIndexer } from './tag-indexer.mjs';
const raw = (id = 1, extra = {}) => ({
  id,
  type: 2,
  name: `作品${id}`,
  name_cn: `作品${id}`,
  platform: 1,
  tags: [{ name: '恋爱' }],
  rating: { score: 8, total: 100 },
  ...extra,
});
const search = (db, query) => searchCatalog(db, new URLSearchParams(query));

test('数字细分类、文字细分类一致，旧库回填幂等，不影响个人资料', () => {
  const db = openDatabase(':memory:');
  try {
    for (const [id, platform] of [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 5],
      [5, 2006],
      [6, 0],
    ])
      upsertSubject(db, raw(id, { platform }));
    db.prepare("UPDATE subjects SET platform=''").run();
    assert.equal(repairCatalog(db).categories, 6);
    assert.deepEqual(
      db
        .prepare('SELECT platform FROM subjects ORDER BY bangumi_id')
        .all()
        .map((row) => row.platform),
      ['TV', 'OVA', '剧场版', 'WEB', '动态漫画', '其他'],
    );
    assert.equal(repairCatalog(db).categories, 0);
    const subject = db.prepare('SELECT id FROM subjects WHERE bangumi_id=3').get();
    assert.equal(getSubject(db, subject.id).category.code, 'movie');
  } finally {
    db.close();
  }
});

test('首页、名称、标签、评分检索默认至少100人；显式0仍可查询全部', () => {
  const db = openDatabase(':memory:');
  try {
    for (const [id, total] of [
      [1, 99],
      [2, 100],
      [3, 101],
    ])
      upsertSubject(db, raw(id, { rating: { score: 8, total } }));
    for (const query of ['', 'q=作品', 'tag=恋爱', 'minScore=7&maxScore=9'])
      assert.equal(search(db, query).total, 2);
    assert.equal(search(db, 'minVotes=0').total, 3);
  } finally {
    db.close();
  }
});

test('API标签不会被短归档覆盖，两种检索索引均保留补全，API更新可移除其自身旧标签', () => {
  const db = openDatabase(':memory:');
  try {
    const id = storeMetadata(db, raw(1, { tags: [{ name: '恋爱' }, { name: '党争' }] }));
    transaction(db, () =>
      upsertSubject(db, raw(1, { platform: 1, tags: [{ name: '恋爱' }, { name: '校园' }] })),
    );
    assert.equal(search(db, 'tag=党争').total, 1);
    assert.equal(search(db, 'q=党争').total, 1);
    repairCatalog(db);
    assert.equal(search(db, 'tag=党争').total, 1);
    assert.ok(getSubject(db, id).tags.includes('校园'));
    storeMetadata(db, raw(1, { tags: [{ name: '新标签' }] }));
    assert.equal(search(db, 'tag=党争').total, 0);
    assert.equal(search(db, 'tag=校园').total, 1);
  } finally {
    db.close();
  }
});

test('标签搜索分页独立补索引，忽略摘要的少量标签，保留作品名与评分，失败不半替换', async () => {
  const db = openDatabase(':memory:');
  try {
    const id = upsertSubject(db, raw(1, { name_cn: '完整作品名' }));
    upsertSubject(db, raw(2));
    const client = {
      searchTag: async (tag, offset) => ({
        total: 2,
        data:
          offset === 0
            ? [{ id: 1, type: 2, name_cn: '摘要名', tags: [] }]
            : [{ id: 2, type: 2, tags: [] }],
      }),
    };
    assert.equal((await syncTag(db, client, '党争')).matched, 2);
    assert.equal(search(db, 'tag=党争').total, 2);
    assert.equal(getSubject(db, id).name_cn, '完整作品名');
    transaction(db, () => upsertSubject(db, raw(1, { tags: [] })));
    assert.equal(search(db, 'tag=党争').total, 2);
    await assert.rejects(syncTag(db, { searchTag: async () => ({ total: 2, data: [] }) }, '党争'));
    assert.equal(search(db, 'tag=党争').total, 2);
    await syncTag(
      db,
      { searchTag: async () => ({ total: 1, data: [{ id: 1, type: 2 }] }) },
      '党争',
    );
    assert.equal(search(db, 'tag=党争').total, 1);
    assert.equal(search(db, 'q=作品').total, 2);
  } finally {
    db.close();
  }
});

test('批量同步记录进度可续跑，限流时停止，搜索任务合并并缓存', async () => {
  const db = openDatabase(':memory:');
  try {
    upsertSubject(db, raw(1));
    upsertSubject(db, raw(2));
    let calls = 0;
    const client = {
      request: async () => {
        calls++;
        return raw(calls);
      },
    };
    assert.equal((await syncMetadata(db, client, { limit: 1 })).succeeded, 1);
    assert.equal((await syncMetadata(db, client, { limit: 2 })).succeeded, 1);
    assert.equal((await syncMetadata(db, client, { limit: 2 })).selected, 0);
    let tagCalls = 0;
    const index = tagIndexer(db, {
      searchTag: async () => {
        tagCalls++;
        return { total: 1, data: [{ id: 1, type: 2 }] };
      },
    });
    assert.equal(index.state(['党争']).pending, true);
    assert.equal(index.state(['党争']).pending, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(index.state(['党争']).pending, false);
    assert.equal(tagCalls, 1);
    index.close();
  } finally {
    db.close();
  }
});
