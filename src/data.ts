// Legacy browser-storage contract, retained only for migration and validation.
// Live pages use src/types.ts and the server API; no demo catalog is rendered.
export const feelings = ['烂透了', '不太行', '一般', '好看', '神回'] as const;
export type Feeling = (typeof feelings)[number];
export interface Scene {
  time: string;
  text: string;
}
export interface Note {
  id: string;
  userId: string;
  subjectId: string;
  episodeId: string;
  body: string;
  feeling: Feeling | null;
  scenes: Scene[];
  isPublic: boolean;
  spoiler: boolean | null;
  updatedAt: string;
}
export interface Review {
  id: string;
  subjectId: string;
  userId: string;
  body: string;
  score: number | null;
  isPublic: boolean;
  spoiler: boolean | null;
  updatedAt: string;
}
export interface Library {
  notes: Note[];
  reviews: Review[];
  watched: string[];
  collected: boolean;
  calendarWatched: string[];
}
export const emptyLibrary: Library = {
  notes: [],
  reviews: [],
  watched: [],
  collected: false,
  calendarWatched: [],
};
