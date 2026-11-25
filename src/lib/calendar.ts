const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function slotInZone(weekday: number, time: string | null, zone: string, now = new Date()) {
  if (!time) return { day: weekday - 1, time: null };
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(now);
  const value = (name: string) => p.find((i) => i.type === name)!.value;
  const today = weekdays.indexOf(value('weekday'));
  const [hour, minute] = time.split(':').map(Number);
  const date = new Date(
    Date.UTC(
      Number(value('year')),
      Number(value('month')) - 1,
      Number(value('day')) - today + (weekday - 1),
      hour - 9,
      minute,
    ),
  );
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return {
    day: weekdays.indexOf(local.find((i) => i.type === 'weekday')!.value),
    time: `${local.find((i) => i.type === 'hour')!.value}:${local.find((i) => i.type === 'minute')!.value}`,
  };
}
