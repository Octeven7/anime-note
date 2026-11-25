import { it, expect } from 'vitest';
import { normalizeTimestamp } from './time';
it('名场面支持空时间、中文冒号、纯数字与小时单位', () => {
  for (const [input, output] of [
    ['', ''],
    ['1235', '12:35'],
    ['１２：３５', '12:35'],
    ['1：02：03', '1:02:03'],
    ['10203', '1:02:03'],
    ['1小时2分3秒', '1:02:03'],
    ['1小时', '1:00:00'],
    ['1时3秒', '1:00:03'],
    ['12分', '12:00'],
    ['90', '01:30'],
  ])
    expect(normalizeTimestamp(input)).toBe(output);
  expect(normalizeTimestamp('12:99')).toBe(null);
  expect(normalizeTimestamp('1:62:03')).toBe(null);
});
