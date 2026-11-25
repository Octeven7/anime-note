import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateNote } from './validation';
import { emptyLibrary, type Note } from '../data';
import { loadLibrary, saveLibrary, validTime } from './storage';
const note: Note = {
  id: 'test',
  userId: 'user',
  subjectId: 'subject',
  episodeId: 'ep',
  body: '演出很好',
  feeling: null,
  scenes: [],
  isPublic: false,
  spoiler: null,
  updatedAt: '2026-01-01',
};
describe('单集记录发布规则', () => {
  it('默认私密无需声明剧透', () => expect(validateNote(note)).toBeNull());
  it('公开必须明确声明，有无剧透均有效', () => {
    expect(validateNote({ ...note, isPublic: true })).toContain('请选择');
    expect(validateNote({ ...note, isPublic: true, spoiler: false })).toBeNull();
    expect(validateNote({ ...note, isPublic: true, spoiler: true })).toBeNull();
  });
  it('允许只选观感，不强制写正文', () =>
    expect(validateNote({ ...note, body: '', feeling: '好看' })).toBeNull());
  it('拒绝空白记录和不完整的名场面', () => {
    expect(validateNote({ ...note, body: ' ' })).not.toBeNull();
    expect(validateNote({ ...note, scenes: [{ time: '12:99', text: '场景' }] })).not.toBeNull();
    expect(validateNote({ ...note, scenes: [{ time: '12:35', text: '' }] })).not.toBeNull();
  });
  it('时间戳校验秒数与格式', () => {
    expect(validTime('12:35')).toBe(true);
    expect(validTime('100:00')).toBe(true);
    expect(validTime('12:60')).toBe(false);
    expect(validTime('abc')).toBe(false);
  });
});
describe('本地持久化', () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    });
  });
  it('同一集多条笔记独立保留，刷新后可恢复', () => {
    const library = {
      ...emptyLibrary,
      notes: [note, { ...note, id: 'second', body: '重看时的想法' }],
    };
    saveLibrary(library);
    expect(loadLibrary().notes).toHaveLength(2);
    expect(loadLibrary().notes[1].body).toBe('重看时的想法');
  });
  it('损坏数据安全回退', () => {
    localStorage.setItem('paper-screen:library:v1', 'broken');
    expect(loadLibrary()).toEqual(emptyLibrary);
  });
  it('保存失败向调用方抛出，不显示虚假成功', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(() => saveLibrary(emptyLibrary)).toThrow('quota');
  });
});
