export function stepYear(value: string, direction: 1 | -1, currentYear = new Date().getFullYear()) {
  if (!value || !Number.isInteger(Number(value))) return String(currentYear);
  return String(Math.min(2200, Math.max(1900, Number(value) + direction)));
}
export function scoreRangeError(min: string, max: string) {
  for (const value of [min, max]) {
    if (value && (!/^\d{1,2}(?:\.\d)?$/.test(value) || Number(value) > 10))
      return '评分请输入0至10的整数或一位小数。';
  }
  if (min && max && Number(min) > Number(max)) return '最低评分不能大于最高评分。';
  return '';
}
