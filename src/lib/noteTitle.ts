import type { Note } from '../types';
export function noteTitle(note: Note) {
  return (
    note.draft.title?.trim() ||
    note.draft.body
      .split('\n')
      .find((line) => line.trim())
      ?.replace(/[#*_~|<>]/g, '')
      .trim()
      .slice(0, 80) ||
    `${note.subjectTitle} · ${note.scope === 'overall' ? '整体评价' : `第 ${note.episode?.sort ?? '?'} 话感想`}`
  );
}
