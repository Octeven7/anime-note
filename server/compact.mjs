export const keyStaff = new Set([
  '动画制作',
  '制作',
  '原作',
  '导演',
  '总导演',
  '系列构成',
  '脚本',
  '人物设定',
  '角色设计',
  '音乐',
]);
export function compactSubject(raw) {
  const rating = raw.rating || {
    score: raw.score,
    rank: raw.rank,
    total: raw.score_details
      ? Object.values(raw.score_details).reduce((a, b) => a + b, 0)
      : undefined,
  };
  return {
    id: raw.id,
    type: raw.type,
    name: raw.name,
    name_cn: raw.name_cn,
    summary: raw.summary,
    date: raw.date,
    platform: raw.platform,
    nsfw: raw.nsfw,
    images: raw.images ? { common: raw.images.common || raw.images.large } : undefined,
    infobox: Array.isArray(raw.infobox) ? raw.infobox : undefined,
    tags: raw.tags?.map((t) => (typeof t === 'string' ? t : t.name)),
    meta_tags: raw.meta_tags,
    rating: { score: rating.score, total: rating.total, rank: rating.rank },
  };
}
export const compactCharacter = (raw) => ({
  images: raw.images?.medium ? { medium: raw.images.medium } : undefined,
});
export function compactCatalog(db) {
  for (const row of db.prepare('SELECT subject_id,payload FROM source_records').all())
    db.prepare('UPDATE source_records SET payload=? WHERE subject_id=?').run(
      JSON.stringify(compactSubject(JSON.parse(row.payload))),
      row.subject_id,
    );
  db.exec("UPDATE subject_metadata_sync SET payload=NULL; UPDATE episodes SET payload='{}';");
  for (const row of db.prepare('SELECT id,payload FROM characters').all())
    db.prepare('UPDATE characters SET payload=? WHERE id=?').run(
      JSON.stringify(compactCharacter(JSON.parse(row.payload))),
      row.id,
    );
  for (const row of db.prepare('SELECT subject_id,person_id,relation FROM subject_staff').all())
    if (!keyStaff.has(row.relation))
      db.prepare('DELETE FROM subject_staff WHERE subject_id=? AND person_id=? AND relation=?').run(
        row.subject_id,
        row.person_id,
        row.relation,
      );
  db.exec(
    "UPDATE persons SET payload='{}'; DELETE FROM persons WHERE id NOT IN (SELECT person_id FROM subject_staff UNION SELECT person_id FROM character_voices);",
  );
}
