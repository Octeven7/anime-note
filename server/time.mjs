export function normalizeTimestamp(value) {
  if (typeof value !== 'string' || value.length > 32) return null;
  let text = value.normalize('NFKC').trim().replace(/\s/g, '');
  if (!text) return '';
  const units = text.match(
    /^(?:(\d{1,3})(?:小时|时|時))?(?:(\d{1,3})(?:分钟|分))?(?:(\d{1,3})秒)?$/,
  );
  if (units && units.slice(1).some(Boolean)) {
    const [, hour, minute = '0', second = '0'] = units;
    if (Number(second) >= 60 || (hour !== undefined && Number(minute) >= 60)) return null;
    return `${hour !== undefined ? `${Number(hour)}:` : ''}${String(Number(minute)).padStart(2, '0')}:${String(Number(second)).padStart(2, '0')}`;
  }
  text = text
    .replace(/小时|時|时/g, ':')
    .replace(/分钟|分/g, ':')
    .replace(/秒$/, '')
    .replace(/:$/, ':00');
  if (/^\d{1,6}$/.test(text)) {
    if (text.length <= 2)
      return `${String(Math.floor(Number(text) / 60)).padStart(2, '0')}:${String(Number(text) % 60).padStart(2, '0')}`;
    text =
      text.length <= 4
        ? `${text.slice(0, -2)}:${text.slice(-2)}`
        : `${text.slice(0, -4)}:${text.slice(-4, -2)}:${text.slice(-2)}`;
  }
  if (!/^\d{1,3}:\d{1,2}(?::\d{1,2})?$/.test(text)) return null;
  const parts = text.split(':').map(Number);
  if (parts.at(-1) >= 60 || (parts.length === 3 && parts[1] >= 60)) return null;
  return parts
    .map((part, index) =>
      index === 0 && parts.length === 3 ? String(part) : String(part).padStart(2, '0'),
    )
    .join(':');
}
