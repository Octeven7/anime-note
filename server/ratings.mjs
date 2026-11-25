export function distribution(raw) {
  const input = raw.rating?.count ?? raw.score_details;
  if (!input || typeof input !== 'object') return null;
  const counts = Array.from({ length: 10 }, (_, i) => input[String(i + 1)]);
  if (counts.some((n) => !Number.isSafeInteger(n) || n < 0)) return null;
  const total = counts.reduce((a, b) => a + b, 0);
  const sum = counts.reduce((a, b, i) => a + b * (i + 1), 0);
  if (!Number.isSafeInteger(sum) || (raw.rating?.total !== undefined && raw.rating.total !== total))
    return null;
  return { counts, total, sum };
}

export function storeRatings(db, id, raw, fetchedAt, source) {
  const d = distribution(raw);
  if (!d) return false;
  const old = db
    .prepare('SELECT source,fetched_at FROM subject_ratings WHERE subject_id=?')
    .get(id);
  if (old && ((old.source === 'api' && source === 'archive') || old.fetched_at > fetchedAt))
    return false;
  db.prepare(
    `INSERT INTO subject_ratings(subject_id,counts,total,sum,fetched_at,source) VALUES(?,?,?,?,?,?)
    ON CONFLICT(subject_id) DO UPDATE SET counts=excluded.counts,total=excluded.total,sum=excluded.sum,fetched_at=excluded.fetched_at,source=excluded.source,last_attempt_at=NULL,last_error=NULL`,
  ).run(id, JSON.stringify(d.counts), d.total, d.sum, fetchedAt, source);
  db.prepare('UPDATE subjects SET score=?,rating_count=?,rank=COALESCE(?,rank) WHERE id=?').run(
    d.total ? Math.round((d.sum / d.total) * 10) / 10 : 0,
    d.total,
    raw.rating?.rank ?? raw.rank ?? null,
    id,
  );
  return true;
}

export function backfillRatings(db) {
  const rows = db
    .prepare('SELECT subject_id,payload,fetched_at,detail_complete FROM source_records')
    .all();
  for (const row of rows)
    storeRatings(
      db,
      row.subject_id,
      JSON.parse(row.payload),
      row.fetched_at,
      row.detail_complete ? 'api' : 'archive',
    );
  for (const row of db
    .prepare(
      'SELECT subject_id,payload,fetched_at FROM subject_metadata_sync WHERE payload IS NOT NULL',
    )
    .all())
    storeRatings(db, row.subject_id, JSON.parse(row.payload), row.fetched_at, 'api');
}
