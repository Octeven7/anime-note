import { emptyLibrary, type Library } from '../data';
export const STORAGE_KEY = 'paper-screen:library:v1';
export function loadLibrary(): Library {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return emptyLibrary;
    const data = JSON.parse(value);
    if (
      !Array.isArray(data.notes) ||
      !Array.isArray(data.reviews) ||
      !Array.isArray(data.watched) ||
      !Array.isArray(data.calendarWatched) ||
      typeof data.collected !== 'boolean'
    )
      return emptyLibrary;
    return data;
  } catch {
    return emptyLibrary;
  }
}
export function saveLibrary(library: Library) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}
export function validTime(value: string) {
  return /^(?:\d{1,3}):[0-5]\d$/.test(value);
}
