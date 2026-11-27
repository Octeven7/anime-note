import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './database.mjs';
import { storeBundle, getSubject } from './catalog.mjs';
import { refreshDetail } from './detail-refresh.mjs';

test('各项独立保存，角色失败不阻断评分和章节，已有角色与观看进度保留', async () => {
  const db = openDatabase(':memory:');
  try {
    const id = storeBundle(db, {
      subject: { id: 1, type: 2, name: '作品' },
      episodes: [{ id: 10, sort: 1, type: 0, name: '旧章节' }],
      characters: [{ id: 20, name: '原角色', actors: [{ id: 30, name: '原声优' }] }],
      persons: [],
    });
    const before = db.prepare('SELECT * FROM character_voices').all();
    db.prepare('INSERT INTO episode_progress VALUES (?,?,?,?,?)').run(
      'local-user',
      id,
      'bgm-episode-10',
      1,
      new Date().toISOString(),
    );
    const counts = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [index + 1, 1]));
    const client = {
      request: async (path) => {
        if (path.startsWith('/subject/'))
          return {
            id: 1,
            type: 2,
            rating: { total: 10, count: counts },
            eps: [{ id: 10, sort: 1, type: 0, name: '新章节', airdate: '2026-11-26' }],
            staff: [],
          };
        throw new Error('上游失败');
      },
    };
    const result = await refreshDetail(db, client, 1, 'all');
    assert.deepEqual(
      result.results.map(({ section, ok }) => [section, ok]),
      [
        ['metadata', false],
        ['ratings', true],
        ['episodes', true],
        ['characters', false],
        ['staff', true],
      ],
    );
    assert.equal(getSubject(db, id).rating_count, 10);
    assert.equal(getSubject(db, id).episodes[0].name, '新章节');
    assert.deepEqual(db.prepare('SELECT * FROM character_voices').all(), before);
    assert.equal(db.prepare('SELECT watched FROM episode_progress').get().watched, 1);
    assert.equal(db.prepare('SELECT detail_complete FROM source_records').get().detail_complete, 1);
  } finally {
    db.close();
  }
});
