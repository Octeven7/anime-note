export type Feeling = 'awful' | 'weak' | 'fair' | 'good' | 'masterpiece';
export const feelings: { value: Feeling; label: string }[] = [
  { value: 'awful', label: '烂透了' },
  { value: 'weak', label: '不太行' },
  { value: 'fair', label: '一般' },
  { value: 'good', label: '好看' },
  { value: 'masterpiece', label: '神回' },
];
export interface Scene {
  time: string;
  text: string;
}
export interface Content {
  title?: string;
  body: string;
  feeling: Feeling | null;
  scenes: Scene[];
  isPublic: boolean;
}
export interface Episode {
  id: string;
  bangumi_id: number;
  sort: number;
  type: number;
  name: string;
  name_cn: string;
  air_date: string | null;
}
export interface Subject {
  id: string;
  bangumi_id: number;
  name: string;
  name_cn: string;
  summary: string;
  air_date: string | null;
  platform: string;
  score: number | null;
  rating_count: number | null;
  score_exact?: number | null;
  rating_distribution?: Record<string, number> | null;
  rating_updated_at?: string | null;
  rating_refresh_pending?: boolean;
  rank: number | null;
  image_url: string | null;
  nsfw: number;
  tags: string[];
  aliases: string[];
  restricted?: boolean;
  status?: string;
  watched?: number;
  myScore?: number | null;
  source?: { name: string; url: string; fetchedAt: string; detailComplete: boolean };
  infobox?: { key: string; value: string | { v: string; k?: string }[] }[];
  episodes?: Episode[];
  characters?: {
    id: string;
    name: string;
    relation: string;
    payload: { images?: { grid?: string; medium?: string } };
    actors: { id: string; name: string }[];
  }[];
  persons?: { id: string; name: string; relation: string }[];
}
export interface Note {
  id: string;
  subjectId: string;
  subjectTitle: string;
  episodeId: string | null;
  episode: { sort: number; type: number; name: string; name_cn: string } | null;
  scope: 'episode' | 'overall';
  version: number;
  createdAt: string;
  updatedAt: string;
  draft: Content & { spoiler: null; updatedAt: string };
  published:
    | (Content & {
        id: string;
        version: number;
        spoiler: boolean | null;
        createdAt: string;
        score?: number | null;
      })
    | null;
}
export interface Page<T> {
  ratingSync?: { pending: boolean };
  tagSync?: {
    pending: boolean;
    states: {
      tag: string;
      pending: boolean;
      error?: string;
      matched?: number;
      received?: number;
      total?: number;
    }[];
  };
  items: T[];
  total: number;
  page: number;
  limit: number;
}
export interface Progress {
  subjectId: string;
  collection: { status: string; updated_at: string } | null;
  episodes: { episode_id: string; watched: boolean; updated_at: string }[];
  history: { id: string; episode_id: string; watched_at: string }[];
}
export interface Ratings {
  current: { id: string; score: number; rated_at: string } | null;
  items: { id: string; score: number; rated_at: string }[];
}
export interface Impression {
  title?: string;
  noteId: string;
  scope: string;
  episodeId: string | null;
  author: string;
  version: number;
  createdAt: string;
  spoiler: boolean;
  hidden: boolean;
  body?: string;
  score?: number | null;
  feeling?: Feeling | null;
  scenes?: Scene[];
}
export interface CalendarItem {
  id: string;
  bangumiId: number;
  title: string;
  image: string | null;
  weekday: number;
  time: string | null;
  collection: string | null;
  latestEpisode: Episode | null;
  watched: boolean;
  feeling: Feeling | null;
}
export interface CalendarData {
  year: number;
  quarter: number;
  mode: 'calendar' | 'archive';
  fetchedAt: string | null;
  warning: string | null;
  sourceTimeZone: string;
  notice: string;
  items: CalendarItem[];
}
