import type { Note } from '../data';
import { validTime } from './storage';
export function validateNote(n: Note): string | null {
  if (n.isPublic && n.spoiler === null) return '请选择含剧透或不含剧透后再发布。';
  if (!n.body.trim() && !n.feeling && !n.scenes.some((s) => s.text.trim()))
    return '写一句感想，或选择一个观感即可。';
  if (n.scenes.some((s) => !validTime(s.time) || !s.text.trim()))
    return '名场面请填写有效时间（如 12:35）及一句话。';
  return null;
}
