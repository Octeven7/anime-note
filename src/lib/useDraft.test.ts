import { describe, it, expect } from 'vitest';
import { emptyContent, hasNoteContent } from './useDraft';

describe('自动保存触发条件', () => {
  it('空白、仅切换公开开关或添加空名场面不构成记录', () => {
    expect(hasNoteContent(emptyContent())).toBe(false);
    expect(hasNoteContent({ ...emptyContent(), body: ' \n ', isPublic: true })).toBe(false);
    expect(hasNoteContent({ ...emptyContent(), scenes: [{ time: '12:35', text: '  ' }] })).toBe(
      false,
    );
  });
  it('正文、单独观感或名场面描述均可自动保存', () => {
    expect(hasNoteContent({ ...emptyContent(), body: '这一集的演出' })).toBe(true);
    expect(hasNoteContent({ ...emptyContent(), feeling: 'good' })).toBe(true);
    expect(hasNoteContent({ ...emptyContent(), scenes: [{ time: '12:35', text: '转场' }] })).toBe(
      true,
    );
  });
});
