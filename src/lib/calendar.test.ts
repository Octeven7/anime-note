import { describe, it, expect } from 'vitest';
import { slotInZone } from './calendar';
describe('放送时区换算', () => {
  it('无时刻保持原星期而不推测', () =>
    expect(slotInZone(1, null, 'America/Chicago')).toEqual({ day: 0, time: null }));
  it('北京时间跨日，支持日本深夜的25点写法', () => {
    const now = new Date('2026-11-21T12:00:00Z');
    expect(slotInZone(1, '00:30', 'Asia/Shanghai', now)).toEqual({ day: 6, time: '23:30' });
    expect(slotInZone(1, '25:30', 'Asia/Shanghai', now)).toEqual({ day: 1, time: '00:30' });
  });
});
