import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './database.mjs';
import { storeBundle, getSubject, searchCatalog } from './catalog.mjs';
import { compactCatalog } from './compact.mjs';
test('入库与重复精简保留展示、搜索和评分字段，舍弃冗余人物档案及非关键岗位', () => {
  const db = openDatabase(':memory:');
  try {
    const id = storeBundle(db, {
      subject: {
        id: 1,
        type: 2,
        name: '原名',
        name_cn: '作品',
        summary: '简介',
        infobox: [
          { key: '别名', value: '别名' },
          { key: '导演', value: '导演名' },
        ],
        rating: {
          score: 8,
          total: 100,
          count: Object.fromEntries(
            Array.from({ length: 10 }, (_, i) => [i + 1, i === 7 ? 100 : 0]),
          ),
        },
        tags: [{ name: '奇幻', count: 20 }],
      },
      episodes: [
        {
          id: 11,
          sort: 1,
          type: 0,
          name: '第一话',
          airdate: '2026-01-01',
          desc: '不展示的章节正文',
        },
      ],
      characters: [
        {
          id: 2,
          name: '角色',
          relation: '主角',
          summary: '不展示的介绍',
          images: { medium: 'https://lain.bgm.tv/test.jpg' },
          actors: [{ id: 3, name: '声优', short_summary: '不展示的生平' }],
        },
      ],
      persons: [
        { id: 4, name: '制作公司', relation: '动画制作', short_summary: '简介' },
        { id: 5, name: '原画师', relation: '原画' },
      ],
    });
    const before = getSubject(db, id);
    assert.equal(before.characters[0].actors[0].name, '声优');
    assert.equal(before.characters[0].payload.images.medium, 'https://lain.bgm.tv/test.jpg');
    assert.equal(before.persons.length, 1);
    assert.equal(before.persons[0].name, '制作公司');
    assert.equal(before.episodes[0].name, '第一话');
    assert.equal(before.score_exact, 8);
    assert.equal(searchCatalog(db, new URLSearchParams('q=别名')).total, 1);
    assert.equal(db.prepare('SELECT payload FROM subject_metadata_sync').get().payload, null);
    assert.ok(!JSON.stringify(before).includes('不展示'));
    compactCatalog(db);
    compactCatalog(db);
    assert.deepEqual(getSubject(db, id), before);
    assert.equal(db.prepare('SELECT count(*) n FROM persons').get().n, 2);
  } finally {
    db.close();
  }
});
