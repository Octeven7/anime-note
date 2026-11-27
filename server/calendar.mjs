import { transaction } from './database.mjs';
import { upsertSubject, InputError, declaredEpisodeCount } from './catalog.mjs';
import { ACTOR } from './personal.mjs';
import { animeCategory } from './categories.mjs';

function otherReleases(db, from, to, weeklyIds) {
  const moviePlatform = animeCategory('movie').name;
  const datesBySubject = new Map();
  const movies = db
    .prepare(
      'SELECT id,bangumi_id,name,name_cn,image_url,air_date FROM subjects WHERE nsfw=0 AND platform=? AND air_date>=? AND air_date<?',
    )
    .all(moviePlatform, from, to);
  const dates = db
    .prepare(
      `WITH candidates AS (
         SELECT subject_id FROM episodes WHERE air_date>=? AND air_date<? AND type=0 AND sort>0
         UNION SELECT value FROM json_each(?)
       )
       SELECT s.id,s.bangumi_id,s.name,s.name_cn,s.image_url,s.platform,
              CASE WHEN date(e.air_date)=e.air_date THEN e.air_date END AS release_date,
              count(*) AS episodes
       FROM candidates c JOIN subjects s ON s.id=c.subject_id
       JOIN episodes e ON e.subject_id=s.id
       WHERE s.nsfw=0 AND s.platform IS NOT ? AND e.type=0 AND e.sort>0
       GROUP BY s.id,release_date ORDER BY s.id,release_date`,
    )
    .all(from, to, JSON.stringify(weeklyIds), moviePlatform);
  for (const row of dates) {
    if (!datesBySubject.has(row.id)) datesBySubject.set(row.id, []);
    datesBySubject.get(row.id).push(row);
  }

  const releases = [];
  const nonWeekly = new Set();
  const add = (row, date, kind) => {
    if (!date || date < from || date >= to) return;
    releases.push({
      id: row.id,
      bangumiId: row.bangumi_id,
      title: row.name_cn || row.name,
      image: row.image_url,
      date,
      kind,
      episodes: row.episodes ?? null,
    });
  };
  for (const movie of movies) add(movie, movie.air_date, 'movie');
  for (const rows of datesBySubject.values()) {
    const dated = rows.filter((row) => row.release_date);
    const batches = dated.filter((row) => row.episodes >= 2);
    if (rows.length === 1 && batches.length === 1) {
      nonWeekly.add(rows[0].id);
      add(batches[0], batches[0].release_date, 'batch');
    } else if (
      batches.length >= 2 &&
      (batches.length === dated.length || batches.filter((row) => row.episodes >= 3).length >= 2)
    ) {
      nonWeekly.add(rows[0].id);
      for (const row of batches) add(row, row.release_date, 'batchPart');
    } else if (rows[0].platform === 'TV') {
      // A long pause between two runs with weekly dates can indicate a split cour.
      const times = dated.map((row) => Date.parse(row.release_date));
      const daysBetween = (a, b) => (times[b] - times[a]) / 86400000;
      for (let i = 2; i < dated.length - 1; i++) {
        const before = daysBetween(i - 2, i - 1);
        const after = daysBetween(i, i + 1);
        if (before >= 6 && before <= 8 && after >= 6 && after <= 8 && daysBetween(i - 1, i) >= 28)
          add(dated[i], dated[i].release_date, 'resumption');
      }
    }
  }
  releases.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.bangumiId - b.bangumiId,
  );
  return { releases, nonWeekly };
}

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
  let retryAfter = 0;
  return async function getCalendar(p) {
    const now = new Date();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const current = currentSeason(now),
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
      const cachedSeason = cached && currentSeason(new Date(cached.fetched_at));
      const hasCurrentCache = cachedSeason?.year === year && cachedSeason.quarter === quarter;
      if (p.get('refresh') === 'true' || (!hasCurrentCache && Date.now() >= retryAfter)) {
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
          retryAfter = Date.now() + 15 * 60000;
          warning = 'Bangumi 放送接口暂不可用；显示已有缓存或首播季度目录。';
        }
        cached = db.prepare("SELECT * FROM calendar_cache WHERE key='current'").get();
      }
      if (cached) {
        const stamp = currentSeason(new Date(cached.fetched_at));
        if (stamp.year === year && stamp.quarter === quarter) mode = 'calendar';
      }
    }
    const month = (quarter - 1) * 3 + 1;
    const end = month + 3;
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = end === 13 ? `${year + 1}-01-01` : `${year}-${String(end).padStart(2, '0')}-01`;
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
    const { releases, nonWeekly } = otherReleases(
      db,
      from,
      to,
      sourceRows.map((s) => s.id),
    );
    const collectionFor = db.prepare(
      'SELECT status FROM collections WHERE user_id=? AND subject_id=?',
    );
    const items = [];
    for (const s of sourceRows) {
      if (animeCategory(s.platform)?.code === 'movie' || nonWeekly.has(s.id)) continue;
      const collection = collectionFor.get(ACTOR, s.id)?.status ?? null;
      if (only && collection !== 'doing') continue;
      const source = db.prepare('SELECT payload FROM source_records WHERE subject_id=?').get(s.id);
      const archive = db
        .prepare('SELECT fields FROM archive_infoboxes WHERE subject_id=?')
        .get(s.id);
      let time = null;
      const info = (source && JSON.parse(source.payload).infobox) || [];
      const archivedInfo = archive ? JSON.parse(archive.fields) : [];
      if (mode === 'calendar') {
        const value = [...info, ...archivedInfo].find((f) => f.key === '放送时间')?.value;
        if (typeof value === 'string') {
          const match = value.match(/(?:^|\s)([0-2]?\d):([0-5]\d)/);
          if (match && Number(match[1]) < 30) time = `${match[1].padStart(2, '0')}:${match[2]}`;
        }
      }
      const latest = db
        .prepare(
          'SELECT e.id,e.sort,e.name,e.name_cn,e.type,e.air_date FROM episodes e WHERE e.subject_id=? AND e.type=0 AND e.sort>0 AND date(e.air_date)=e.air_date AND e.air_date<=? ORDER BY e.air_date DESC,e.sort DESC LIMIT 1',
        )
        .get(s.id, today);
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
        totalEpisodes: declaredEpisodeCount(info, archivedInfo),
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
      otherReleases: only
        ? releases.filter((release) => collectionFor.get(ACTOR, release.id)?.status === 'doing')
        : releases,
      notice:
        mode === 'calendar'
          ? '每周放送来自 Bangumi。章节按已收录的播出日期显示。'
          : '历史/其他季度按首播日期归类，不代表当时实际每周播出安排。',
    };
  };
}
