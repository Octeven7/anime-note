export const animeCategories = [
  { id: 0, code: 'other', name: '其他' },
  { id: 1, code: 'tv', name: 'TV' },
  { id: 2, code: 'ova', name: 'OVA' },
  { id: 3, code: 'movie', name: '剧场版' },
  { id: 4, code: 'short_film', name: '短片' },
  { id: 5, code: 'web', name: 'WEB' },
  { id: 2006, code: 'anime_comic', name: '动态漫画' },
];
export function animeCategory(value) {
  if (typeof value === 'number') return animeCategories.find((item) => item.id === value) || null;
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^\d+$/.test(value.trim()))
    return animeCategories.find((item) => item.id === Number(value)) || null;
  const text = value.trim().toLowerCase();
  return (
    animeCategories.find((item) => item.code === text || item.name.toLowerCase() === text) || null
  );
}
export const animePlatform = (value) =>
  animeCategory(value)?.name || (typeof value === 'string' ? value.trim() : '');
