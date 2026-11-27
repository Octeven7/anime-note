import type { Subject } from '../types';
import type { Library as LegacyLibrary, Note as LegacyNote } from '../data';
import { emptyLibrary } from '../data';
import { STORAGE_KEY } from './storage';
export function readLegacyBrowser() {
  const library = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as LegacyLibrary | null;
  const drafts: { key: string; value: LegacyNote }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (key.startsWith('paper-screen:draft:frieren-')) {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      if (value && (value.body?.trim() || value.feeling || value.scenes?.length))
        drafts.push({ key, value });
    }
  }
  const hasData = !!(
    library?.notes?.length ||
    library?.reviews?.length ||
    library?.watched?.length ||
    library?.collected ||
    drafts.length
  );
  return { library: library || emptyLibrary, drafts, hasData };
}
const mapFeel: Record<string, string> = {
  烂透了: 'awful',
  不太行: 'weak',
  一般: 'fair',
  好看: 'good',
  神回: 'masterpiece',
};
const legacyEpisode = (value: unknown) => typeof value === 'string' && /^frieren-\d+$/.test(value);
const validLegacyEntry = (value: LegacyNote | LegacyLibrary['reviews'][number] | null) =>
  value &&
  typeof value.id === 'string' &&
  typeof value.body === 'string' &&
  value.subjectId === 'demo-frieren' &&
  typeof value.updatedAt === 'string' &&
  Number.isFinite(Date.parse(value.updatedAt));

export function validateLegacyFile(value: unknown) {
  const data = value as
    (LegacyLibrary & { legacyDrafts?: { key: string; value: LegacyNote }[] }) | null;
  if (
    !data ||
    !Array.isArray(data.notes) ||
    !Array.isArray(data.reviews) ||
    !Array.isArray(data.watched) ||
    typeof data.collected !== 'boolean'
  ) {
    throw new Error('不是本站备份或可识别的旧版手账文件。');
  }
  const validNote = (note: LegacyNote) =>
    validLegacyEntry(note) &&
    legacyEpisode(note.episodeId) &&
    (!note.feeling || Object.hasOwn(mapFeel, note.feeling)) &&
    (note.scenes === undefined ||
      (Array.isArray(note.scenes) &&
        note.scenes.every(
          (scene) => scene && typeof scene.time === 'string' && typeof scene.text === 'string',
        )));
  if (
    !data.notes.every(validNote) ||
    !data.watched.every(legacyEpisode) ||
    !data.reviews.every(
      (review) =>
        validLegacyEntry(review) &&
        (review.score === null ||
          (Number.isInteger(review.score) && review.score >= 1 && review.score <= 10)),
    ) ||
    (data.legacyDrafts !== undefined &&
      (!Array.isArray(data.legacyDrafts) ||
        !data.legacyDrafts.every(
          (draft) => draft && typeof draft.key === 'string' && validNote(draft.value),
        )))
  ) {
    throw new Error('旧版手账的记录、评分或章节格式有误。');
  }
  return data;
}
async function stableId(prefix: string, value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `${prefix}_${Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)}`;
}
export async function legacyBackup(
  value: unknown,
  subject: Subject,
  drafts: { key: string; value: LegacyNote }[] = [],
) {
  const data = value as LegacyLibrary;
  if (
    !data ||
    !Array.isArray(data.notes) ||
    !Array.isArray(data.reviews) ||
    !Array.isArray(data.watched) ||
    typeof data.collected !== 'boolean'
  )
    throw new Error('不是可识别的旧版手账数据。');
  if (subject.bangumi_id !== 400602 || !subject.episodes?.length)
    throw new Error('需要先获取《葬送的芙莉莲》的真实章节，才能迁移旧版演示记录。');
  const exportedAt = new Date().toISOString();
  const output: {
    subjects: unknown[];
    episodes: unknown[];
    notes: unknown[];
    drafts: unknown[];
    revisions: unknown[];
    collections: unknown[];
    progress: unknown[];
    watches: unknown[];
    ratings: unknown[];
  } = {
    subjects: [
      {
        id: subject.id,
        bangumi_id: subject.bangumi_id,
        name: subject.name,
        name_cn: subject.name_cn,
        air_date: subject.air_date,
        nsfw: subject.nsfw,
      },
    ],
    episodes: [],
    notes: [],
    drafts: [],
    revisions: [],
    collections: [],
    progress: [],
    watches: [],
    ratings: [],
  };
  const used = new Map<string, NonNullable<Subject['episodes']>[number]>();
  const ids = new Set<string>();
  const resolve = (old: string) => {
    const match = /^frieren-(\d+)$/.exec(old);
    if (!match) throw new Error(`无法确认旧章节 ${old} 的真实对应关系，未迁移任何数据。`);
    const matches = subject.episodes!.filter((e) => e.type === 0 && e.sort === Number(match[1]));
    if (matches.length !== 1) throw new Error(`第 ${match[1]} 话无法唯一对应，请先刷新章节资料。`);
    used.set(matches[0].id, matches[0]);
    return matches[0].id;
  };
  const add = async (
    source: {
      id: string;
      body: string;
      updatedAt: string;
      subjectId: string;
      feeling?: string | null;
      scenes?: unknown[];
    },
    scope: 'episode' | 'overall',
    oldEpisode?: string,
    isDraft = false,
  ) => {
    if (
      typeof source.id !== 'string' ||
      typeof source.body !== 'string' ||
      source.subjectId !== 'demo-frieren' ||
      !Number.isFinite(Date.parse(source.updatedAt))
    )
      throw new Error('旧记录字段有误或不属于已知演示作品，请先导出原始数据。');
    const key = `${scope}:${isDraft ? 'draft:' : ''}${source.id}`;
    if (ids.has(key)) throw new Error('旧记录存在重复ID');
    ids.add(key);
    const id = await stableId('note_legacy', key),
      revisionId = await stableId('revision_legacy', key),
      episodeId = scope === 'episode' ? resolve(oldEpisode!) : null,
      t = source.updatedAt;
    const feeling = scope === 'episode' && source.feeling ? mapFeel[source.feeling] : null;
    if (source.feeling && !feeling) throw new Error('未知的旧版观感');
    const scenes = JSON.stringify(scope === 'episode' ? source.scenes || [] : []);
    output.notes.push({
      id,
      user_id: 'local-user',
      subject_id: subject.id,
      episode_id: episodeId,
      scope,
      created_at: t,
      deleted_at: null,
      version: isDraft ? 1 : 2,
      updated_at: t,
      published_revision_id: null,
    });
    output.drafts.push({
      note_id: id,
      body: source.body,
      feeling,
      scenes,
      is_public: 0,
      updated_at: t,
    });
    if (!isDraft)
      output.revisions.push({
        id: revisionId,
        note_id: id,
        version: 2,
        state: 'published',
        body: source.body,
        feeling,
        scenes,
        is_public: 0,
        spoiler: null,
        created_at: t,
      });
  };
  for (const note of data.notes) await add(note, 'episode', note.episodeId);
  for (const review of [...data.reviews].reverse()) {
    if (typeof review.body !== 'string' || !Number.isFinite(Date.parse(review.updatedAt)))
      throw new Error('旧版总评格式无效');
    if (review.body.trim()) await add(review, 'overall');
    if (review.score !== null) {
      if (!Number.isInteger(review.score) || review.score < 1 || review.score > 10)
        throw new Error('旧版评分不在1至10之间');
      output.ratings.push({
        id: await stableId('rating_legacy', review.id),
        user_id: 'local-user',
        subject_id: subject.id,
        score: review.score,
        rated_at: review.updatedAt,
      });
    }
  }
  for (const draft of drafts)
    if (draft.value.body?.trim() || draft.value.feeling || draft.value.scenes?.length)
      await add({ ...draft.value, id: draft.key }, 'episode', draft.value.episodeId, true);
  const t =
    [...data.notes, ...data.reviews]
      .map((n) => n.updatedAt)
      .sort()
      .at(-1) || '1970-01-01T00:00:00.000Z';
  if (data.collected)
    output.collections.push({
      user_id: 'local-user',
      subject_id: subject.id,
      status: 'doing',
      updated_at: t,
    });
  for (const old of new Set(data.watched)) {
    const episodeId = resolve(old);
    output.progress.push({
      user_id: 'local-user',
      subject_id: subject.id,
      episode_id: episodeId,
      watched: 1,
      updated_at: t,
    });
  }
  output.episodes = [...used.values()].map((e) => ({
    id: e.id,
    subject_id: subject.id,
    bangumi_id: e.bangumi_id,
    sort: e.sort,
    type: e.type,
    name: e.name,
    name_cn: e.name_cn,
    air_date: e.air_date,
  }));
  return {
    format: 'paper-screen-personal',
    version: 1,
    exportedAt,
    owner: 'local-user',
    data: output,
  };
}
