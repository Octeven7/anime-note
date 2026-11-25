import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './database.mjs';
import { calendarService, currentSeason } from './calendar.mjs';
import { storeBundle } from './catalog.mjs';
import {
  createNote,
  publishNote,
  saveDraft,
  ratingHistory,
  addRating,
  getNote,
  publicImpressions,
  setCollection,
} from './personal.mjs';
import { exportPersonal, restorePersonal } from './backup.mjs';
test('真实放送接口缓存、跨季项目、未提供时刻和在追筛选', async () => {
  const db = openDatabase(':memory:');
  try {
    const { year, quarter } = currentSeason();
    let calls = 0;
    const service = calendarService(db, {
      calendar: async () => {
        calls++;
        return [
          {
            weekday: { id: 1 },
            items: [
              {
                id: 11,
                type: 2,
                name: '跨季动画',
                air_date: '2020-01-01',
                images: { large: 'https://example.com/poster.jpg' },
              },
            ],
          },
        ];
      },
    });
    const params = new URLSearchParams({ year, quarter });
    let result = await service(params);
    assert.equal(result.mode, 'calendar');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].time, null);
    assert.equal(result.items[0].latestEpisode, null);
    await service(params);
    assert.equal(calls, 1);
    params.set('following', 'true');
    assert.equal((await service(params)).items.length, 0);
    setCollection(db, result.items[0].id, { status: 'doing' });
    assert.equal((await service(params)).items.length, 1);
    const failed = calendarService(db, {
      calendar: async () => {
        throw new Error('offline');
      },
    });
    params.set('refresh', 'true');
    result = await failed(params);
    assert.equal(result.mode, 'calendar');
    assert.ok(result.warning);
    const historical = await failed(new URLSearchParams({ year: '2020', quarter: '1' }));
    assert.equal(historical.mode, 'archive');
    assert.equal(historical.items.length, 1);
    assert.equal(historical.items[0].time, null);
  } finally {
    db.close();
  }
});
test('总评文字与评分原子提交，校验失败不留下半条评分', () => {
  const db = openDatabase(':memory:');
  try {
    const sid = storeBundle(db, {
      subject: { id: 1, type: 2, name: '作品' },
      episodes: [],
      characters: [],
      persons: [],
    });
    let n = createNote(db, { subjectId: sid, scope: 'overall' });
    assert.throws(() => publishNote(db, n.id, { expectedVersion: n.version, score: 11 }));
    assert.equal(ratingHistory(db, sid).current, null);
    n = publishNote(db, n.id, { expectedVersion: n.version, score: 9 });
    assert.equal(ratingHistory(db, sid).current.score, 9);
    assert.throws(() => publishNote(db, n.id, { expectedVersion: 1, score: 7 }));
    assert.equal(ratingHistory(db, sid).items.length, 1);
  } finally {
    db.close();
  }
});
test('公开评分关联版本，编辑旧总评不改变后续评分，备份保留关联', () => {
  const db = openDatabase(':memory:'),
    target = openDatabase(':memory:');
  try {
    const sid = storeBundle(db, {
      subject: { id: 1, type: 2, name: '作品' },
      episodes: [],
      characters: [],
      persons: [],
    });
    let note = createNote(db, { subjectId: sid, scope: 'overall', isPublic: true });
    note = publishNote(db, note.id, { expectedVersion: note.version, spoiler: false, score: 9 });
    assert.equal(publicImpressions(db, sid, new URLSearchParams()).items[0].score, 9);
    addRating(db, sid, { score: 7 });
    note = saveDraft(db, note.id, { expectedVersion: note.version, body: '只改文字' });
    note = publishNote(db, note.id, { expectedVersion: note.version, spoiler: false });
    assert.equal(ratingHistory(db, sid).current.score, 7);
    assert.equal(getNote(db, note.id).published.score, 9);
    restorePersonal(target, exportPersonal(db));
    assert.equal(
      target.prepare('SELECT count(*) n FROM overall_ratings WHERE revision_id IS NOT NULL').get()
        .n,
      1,
    );
  } finally {
    db.close();
    target.close();
  }
});
