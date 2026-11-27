import { describe, it, expect } from 'vitest';
import { legacyBackup, validateLegacyFile } from './legacy';
import type { Subject } from '../types';
const subject: Subject = {
  id: 'subject-real',
  bangumi_id: 400602,
  name: '葬送のフリーレン',
  name_cn: '葬送的芙莉莲',
  summary: '',
  air_date: '2023-09-29',
  platform: 'TV',
  score: 9,
  rating_count: 10,
  rank: 1,
  image_url: null,
  nsfw: 0,
  tags: [],
  aliases: [],
  episodes: [
    {
      id: 'bgm-episode-100',
      bangumi_id: 100,
      sort: 1,
      type: 0,
      name: '冒险结束',
      name_cn: '',
      air_date: '2023-09-29',
    },
  ],
};
const note = {
  id: 'old',
  userId: 'local-user',
  subjectId: 'demo-frieren',
  episodeId: 'frieren-1',
  body: '旧笔记',
  feeling: '神回',
  scenes: [{ time: '12:35', text: '演出' }],
  isPublic: true,
  spoiler: true,
  updatedAt: '2026-11-01T12:00:00.000Z',
};
describe('旧记录迁移', () => {
  it('文件读取阶段过滤无关 JSON 和记录损坏的旧备份', () => {
    expect(() => validateLegacyFile({ kind: 'unrelated' })).toThrow('不是本站备份');
    const valid = { notes: [note], reviews: [], watched: ['frieren-1'], collected: false };
    expect(validateLegacyFile(valid)).toEqual(valid);
    expect(() => validateLegacyFile({ ...valid, notes: [null] })).toThrow('格式有误');
    expect(() => validateLegacyFile({ ...valid, watched: ['wrong-episode'] })).toThrow('格式有误');
  });
  it('按正篇集数匹配，稳定ID且不自动公开，不虚构观看时间', async () => {
    const data = {
      notes: [note],
      reviews: [],
      watched: ['frieren-1'],
      collected: true,
      calendarWatched: ['a1'],
    };
    const a = await legacyBackup(data, subject),
      b = await legacyBackup(data, subject);
    expect(a.data.notes).toEqual(b.data.notes);
    expect(a.data.notes[0]).toMatchObject({
      episode_id: 'bgm-episode-100',
      published_revision_id: null,
    });
    expect(a.data.drafts[0]).toMatchObject({ is_public: 0, feeling: 'masterpiece' });
    expect(a.data.watches).toEqual([]);
    expect(a.data.progress).toHaveLength(1);
  });
  it('无法唯一对应或未知作品时停止，避免错绑笔记', async () => {
    await expect(
      legacyBackup(
        { notes: [{ ...note, episodeId: 'unknown' }], reviews: [], watched: [], collected: false },
        subject,
      ),
    ).rejects.toThrow('对应');
    await expect(
      legacyBackup(
        { notes: [{ ...note, subjectId: 'other' }], reviews: [], watched: [], collected: false },
        subject,
      ),
    ).rejects.toThrow('不属于');
  });
  it('相同毫秒的评分保留旧版列表中新记录优先的顺序', async () => {
    const result = await legacyBackup(
      {
        notes: [],
        reviews: [
          {
            id: 'new',
            subjectId: 'demo-frieren',
            body: '新总评',
            updatedAt: note.updatedAt,
            score: 9,
          },
          {
            id: 'old',
            subjectId: 'demo-frieren',
            body: '旧总评',
            updatedAt: note.updatedAt,
            score: 7,
          },
        ],
        watched: [],
        collected: false,
      },
      subject,
    );
    expect(result.data.ratings.map((r) => (r as { score: number }).score)).toEqual([7, 9]);
  });
});
