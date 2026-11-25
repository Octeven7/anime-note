import { transaction } from './database.mjs';
import { upsertSubject, InputError } from './catalog.mjs';
import { ACTOR } from './personal.mjs';

export function currentSeason(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);
  return {
    year: Number(parts.find((p) => p.type === 'year').value),
    quarter: Math.ceil(Number(parts.find((p) => p.type === 'month').value) / 3),
  };
}
export function calendarService(db, client) {
  let pending = null;
  return async function getCalendar(p) {
    const current = currentSeason(),
      year = Number(p.get('year') || current.year),
      quarter = Number(p.get('quarter') || current.quarter),
      only = p.get('following') === 'true';
    if (
      !Number.isInteger(year) ||
      year < 1900 ||
      year > 2200 ||
      !Number.isInteger(quarter) ||
      quarter < 1 ||
      quarter > 4
    )
      throw new InputError('无效季度');
    const live = year === current.year && quarter === current.quarter;
    let cached = db.prepare("SELECT * FROM calendar_cache WHERE key='current'").get(),
      warning = null,
      mode = 'archive';
    if (live) {
      if (
        !cached ||
        Date.now() - Date.parse(cached.fetched_at) > 6 * 3600000 ||
        p.get('refresh') === 'true'
      ) {
        try {
          if (!pending)
            pending = client
              .calendar()
              .then((payload) => {
                if (
                  !Array.isArray(payload) ||
                  payload.some(
                    (d) =>
                      !Number.isInteger(d.weekday?.id) ||
                      d.weekday.id < 1 ||
                      d.weekday.id > 7 ||
                      !Array.isArray(d.items),
                  )
                )
                  throw new Error('放送数据格式异常');
                transaction(db, () => {
                  for (const day of payload)
                    for (const item of day.items) {
                      if (item.type !== 2 || !Number.isSafeInteger(item.id) || !item.name) continue;
                      if (!db.prepare('SELECT id FROM subjects WHERE bangumi_id=?').get(item.id))
                        upsertSubject(db, { ...item, date: item.air_date });
                    }
                  db.prepare(
                    "INSERT INTO calendar_cache VALUES('current',?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at",
                  ).run(JSON.stringify(payload), new Date().toISOString());
                });
              })
              .finally(() => (pending = null));
          await pending;
        } catch {
          warning = 'Bangumi 放送接口暂不可用；显示已有缓存或首播季度目录。';
        }
        cached = db.prepare("SELECT * FROM calendar_cache WHERE key='current'").get();
      }
      if (cached) {
        const stamp = currentSeason(new Date(cached.fetched_at));
        if (stamp.year === year && stamp.quarter === quarter) mode = 'calendar';
      }
    }
    let sourceRows;
    if (mode === 'calendar') {
      const rows = new Map();
      for (const day of JSON.parse(cached.payload))
        for (const item of day.items) {
          const s = db.prepare('SELECT * FROM subjects WHERE bangumi_id=? AND nsfw=0').get(item.id);
          if (s)
            rows.set(s.id, {
              ...s,
              weekday: day.weekday.id,
              image_url: s.image_url || item.images?.large || item.images?.common || null,
            });
        }
      sourceRows = [...rows.values()];
    } else {
      const month = (quarter - 1) * 3 + 1,
        end = month + 3;
      const from = `${year}-${String(month).padStart(2, '0')}-01`,
        to = end === 13 ? `${year + 1}-01-01` : `${year}-${String(end).padStart(2, '0')}-01`;
      sourceRows = db
        .prepare(
          'SELECT * FROM subjects WHERE nsfw=0 AND air_date>=? AND air_date<? ORDER BY air_date,bangumi_id',
        )
        .all(from, to)
        .map((s) => ({
          ...s,
          weekday: ((new Date(s.air_date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1,
        }));
    }
    const items = [];
    for (const s of sourceRows) {
      const collection =
        db
          .prepare('SELECT status FROM collections WHERE user_id=? AND subject_id=?')
          .get(ACTOR, s.id)?.status ?? null;
      if (only && collection !== 'doing') continue;
      const source = db
        .prepare('SELECT payload,detail_complete FROM source_records WHERE subject_id=?')
        .get(s.id);
      let time = null;
      if (mode === 'calendar' && source?.detail_complete) {
        const info = JSON.parse(source.payload).infobox || [];
        const value = info.find?.((f) => f.key === '放送时间')?.value;
        if (typeof value === 'string') {
          const match = value.match(/(?:^|\s)([0-2]?\d):([0-5]\d)/);
          if (match && Number(match[1]) < 30) time = `${match[1].padStart(2, '0')}:${match[2]}`;
        }
      }
      const latest = db
        .prepare(
          'SELECT e.id,e.sort,e.name,e.name_cn,e.type,e.air_date FROM episodes e WHERE e.subject_id=? AND e.type=0 AND e.air_date IS NOT NULL AND e.air_date<=? ORDER BY e.air_date DESC,e.sort DESC LIMIT 1',
        )
        .get(
          s.id,
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Tokyo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date()),
        );
      const watched = latest
        ? !!db
            .prepare('SELECT watched FROM episode_progress WHERE user_id=? AND episode_id=?')
            .get(ACTOR, latest.id)?.watched
        : false;
      const feeling = latest
        ? (db
            .prepare(
              'SELECT d.feeling FROM notes n JOIN note_drafts d ON d.note_id=n.id WHERE n.user_id=? AND n.episode_id=? AND n.deleted_at IS NULL AND d.feeling IS NOT NULL ORDER BY n.updated_at DESC,n.id LIMIT 1',
            )
            .get(ACTOR, latest.id)?.feeling ?? null)
        : null;
      items.push({
        id: s.id,
        bangumiId: s.bangumi_id,
        title: s.name_cn || s.name,
        image: s.image_url,
        weekday: s.weekday,
        time,
        collection,
        latestEpisode: latest ?? null,
        watched,
        feeling,
      });
    }
    return {
      year,
      quarter,
      mode,
      fetchedAt: mode === 'calendar' ? cached.fetched_at : null,
      warning,
      sourceTimeZone: 'Asia/Tokyo',
      items,
      notice:
        mode === 'calendar'
          ? '当前放送表来自 Bangumi；未提供的时刻和最新集数不作推算。'
          : '历史/其他季度按首播日期归类，不代表当时实际每周播出安排。',
    };
  };
}
