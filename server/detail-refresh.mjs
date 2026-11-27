import { InputError, storeBundle, upsertSubject } from './catalog.mjs';
import { transaction } from './database.mjs';

export const refreshSections = ['metadata', 'ratings', 'episodes', 'characters', 'staff'];

export async function refreshDetail(db, client, bangumiId, section) {
  const requested = section === 'all' ? refreshSections : [section];
  if (requested.some((value) => !refreshSections.includes(value)))
    throw new InputError('无效刷新范围');
  const local = db.prepare('SELECT id,nsfw FROM subjects WHERE bangumi_id=?').get(bangumiId);
  if (!local || local.nsfw) throw new InputError('作品不可刷新');
  let legacy;
  if (section !== 'metadata') {
    try {
      legacy = await client.request('/subject/' + bangumiId + '?responseGroup=large');
      if (legacy?.id !== bangumiId || legacy.type !== 2) legacy = null;
    } catch {
      legacy = null;
    }
  }
  const results = [];
  for (const key of requested) {
    try {
      const bundle = { subject: { id: bangumiId }, episodes: [], characters: [], persons: [] };
      let source = 'legacy';
      if (key === 'metadata') {
        const raw = await client.request('/v0/subjects/' + bangumiId);
        if (raw.id !== bangumiId || raw.nsfw || raw.type !== 2) throw new Error('基础资料格式异常');
        const complete =
          db.prepare('SELECT detail_complete FROM source_records WHERE subject_id=?').get(local.id)
            ?.detail_complete === 1;
        transaction(db, () =>
          upsertSubject(db, raw, { detailComplete: complete, tagSource: 'api' }),
        );
        results.push({ section: key, ok: true, source: 'v0' });
        continue;
      } else if (key === 'ratings') {
        bundle.subject = legacy?.rating?.count
          ? { id: bangumiId, rating: { ...legacy.rating, rank: legacy.rank } }
          : await client.request('/v0/subjects/' + bangumiId);
        if (!legacy?.rating?.count) source = 'v0';
      } else if (key === 'episodes') {
        if (Array.isArray(legacy?.eps)) bundle.episodes = legacy.eps;
        else {
          source = 'v0';
          let offset = 0;
          while (true) {
            const page = await client.request(
              `/v0/episodes?subject_id=${bangumiId}&limit=100&offset=${offset}`,
            );
            if (!Array.isArray(page.data)) throw new Error('章节资料格式异常');
            bundle.episodes.push(...page.data);
            offset += page.data.length;
            if (!page.data.length || offset >= page.total) break;
            if (offset > 10000) throw new Error('章节数量超出上限');
          }
        }
      } else if (key === 'characters') {
        if (Array.isArray(legacy?.crt))
          bundle.characters = legacy.crt.map((item) => ({
            ...item,
            relation: item.role_name,
            images: item.images?.medium
              ? { medium: item.images.medium.replace(/^http:/, 'https:') }
              : undefined,
          }));
        else {
          source = 'v0';
          bundle.characters = await client.request('/v0/subjects/' + bangumiId + '/characters');
        }
        if (
          !Array.isArray(bundle.characters) ||
          bundle.characters.some((item) => !Array.isArray(item.actors))
        )
          throw new Error('角色或声优资料不完整');
      } else {
        if (Array.isArray(legacy?.staff) && legacy.staff.every((item) => Array.isArray(item.jobs)))
          bundle.persons = legacy.staff.flatMap((item) =>
            item.jobs.map((relation) => ({ ...item, relation })),
          );
        else {
          source = 'v0';
          bundle.persons = await client.request('/v0/subjects/' + bangumiId + '/persons');
        }
        if (!Array.isArray(bundle.persons)) throw new Error('制作人员资料格式异常');
      }
      storeBundle(db, bundle, { sections: [key] });
      results.push({ section: key, ok: true, source });
    } catch {
      results.push({ section: key, ok: false });
    }
  }
  return { results };
}
