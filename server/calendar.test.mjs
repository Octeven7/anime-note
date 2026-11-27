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
    const subjectId = result.items[0].id;
    db.prepare('INSERT INTO archive_infoboxes VALUES (?,?)').run(
      subjectId,
      JSON.stringify([{ key: '话数', value: '１２' }]),
    );
    const chapter = db.prepare('INSERT INTO episodes VALUES (?,?,?,?,?,?,?,?,?)');
    chapter.run('dated', subjectId, 101, 3, 0, '已收录', '', '2020-01-03', '{}');
    chapter.run('unknown', subjectId, 102, 4, 0, '日期未定', '', '', '{}');
    chapter.run('future', subjectId, 103, 5, 0, '未来章节', '', '2199-01-01', '{}');
    result = await service(params);
    assert.equal(result.items[0].totalEpisodes, 12);
    assert.equal(result.items[0].latestEpisode.id, 'dated');
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
test('当前周播缓存中的集中上线作品也只出现在其他放送', async () => {
  const db = openDatabase(':memory:');
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
    const subject = { id: 1, type: 2, name: '集中上线作品', date: today, platform: 5 };
    storeBundle(db, {
      subject,
      episodes: [1, 2].map((sort) => ({ id: sort, sort, type: 0, airdate: today })),
      characters: [],
      persons: [],
    });
    const service = calendarService(db, {
      calendar: async () => [{ weekday: { id: 1 }, items: [subject] }],
    });
    const result = await service(new URLSearchParams());
    assert.equal(result.mode, 'calendar');
    assert.equal(result.items.length, 0);
    assert.deepEqual(
      result.otherReleases.map((item) => [item.date, item.episodes]),
      [[today, 2]],
    );
  } finally {
    db.close();
  }
});
test('集中上线、跨季度分批、分段复播和剧场版按日期列入其他放送', async () => {
  const db = openDatabase(':memory:');
  try {
    for (const [id, platform, dates] of [
      [1, 5, ['2020-04-03', '2020-04-03']],
      [2, 5, ['2020-04-04', '2020-04-04', '2020-07-03', '2020-07-03']],
      [3, 3, ['2020-07-11']],
      [4, 1, ['2020-07-04', '2020-07-04', '2020-07-11', '2020-07-18']],
      [5, 1, ['2020-05-01', '2020-05-08', '2020-07-10', '2020-07-17']],
    ]) {
      storeBundle(db, {
        subject: { id, type: 2, name: `作品 ${id}`, date: dates[0], platform },
        episodes: dates.map((airdate, index) => ({
          id: id * 10 + index,
          type: 0,
          sort: index + 1,
          airdate,
        })),
        characters: [],
        persons: [],
      });
    }
    const service = calendarService(db, { calendar: async () => [] });
    const quarter = (number) => new URLSearchParams({ year: 2020, quarter: number });
    const spring = await service(quarter(2));
    assert.deepEqual(
      spring.otherReleases.map(({ bangumiId, kind }) => [bangumiId, kind]),
      [
        [1, 'batch'],
        [2, 'batchPart'],
      ],
    );
    assert.deepEqual(
      spring.items.map((item) => item.bangumiId),
      [5],
    );
    const summer = await service(quarter(3));
    assert.deepEqual(
      summer.otherReleases.map(({ bangumiId, date, kind, episodes }) => [
        bangumiId,
        date,
        kind,
        episodes,
      ]),
      [
        [2, '2020-07-03', 'batchPart', 2],
        [5, '2020-07-10', 'resumption', 1],
        [3, '2020-07-11', 'movie', null],
      ],
    );
    assert.deepEqual(
      summer.items.map((item) => item.bangumiId),
      [4],
    );
    setCollection(db, summer.otherReleases[0].id, { status: 'doing' });
    const params = quarter(3);
    params.set('following', 'true');
    assert.deepEqual(
      (await service(params)).otherReleases.map((item) => item.bangumiId),
      [2],
    );
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
