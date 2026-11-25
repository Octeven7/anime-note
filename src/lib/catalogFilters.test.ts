import { it, expect } from 'vitest';
import { stepYear, scoreRangeError } from './catalogFilters';
it('空年份第一次上下操作使用当时年份，其后逐年变化并遵守边界', () => {
  expect(stepYear('', 1, 2032)).toBe('2032');
  expect(stepYear('', -1, 2032)).toBe('2032');
  expect(stepYear('2032', 1, 2032)).toBe('2033');
  expect(stepYear('2032', -1, 2032)).toBe('2031');
  expect(stepYear('1900', -1, 2032)).toBe('1900');
});
it('允许整数或一位小数的闭区间，错误范围不给发起检索', () => {
  expect(scoreRangeError('7.5', '8.0')).toBe('');
  expect(scoreRangeError('8', '8')).toBe('');
  expect(scoreRangeError('', '')).toBe('');
  expect(scoreRangeError('8', '7')).not.toBe('');
  expect(scoreRangeError('7.55', '8')).not.toBe('');
  expect(scoreRangeError('-1', '8')).not.toBe('');
});
