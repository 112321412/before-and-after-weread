// 与服务端 palette.ts 的 10 键结构保持一致（前端只消费）
export interface Palette {
  paper: string;
  paperDeep: string;
  paperPale: string;
  ink: string;
  inkSoft: string;
  shelf: string;
  shelfDark: string;
  light: string;
  fill: string;
  accent: string;
}

export interface ShelfBook {
  bookId: string;
  title: string;
  author: string;
  category: string;
  cover: string;
  dominant: string;
  palette: Palette;
  progress: number;
  finished: boolean;
  abandoned: boolean;
  readMinutes: number;
  lastReadAt: string | null;
  finishedAt: string | null;
  highlights: number;
  thoughts: number;
  archive: string | null;
  sizeSeed: number; // 3D 书体物理尺寸（宽窄高矮）的随机种子，由服务端下发
}

export interface ShelfResponse {
  mode: string;
  books: ShelfBook[];
}

export interface StatsResponse {
  weeklyMinutes: { label: string; minutes: number }[];
  monthMinutes: number;
  finished: number;
  abandoned: number;
  highlights: number;
  thoughts: number;
  recentDecisions: { id: number; topic: string | null; verdict: string; action: string | null; created_at: number }[];
  speedBaseline: { wpm: number; basis: string } | null;
}

export type SyncPhase = "notebooks" | "shelf" | "notes" | "covers" | "readdata" | "baseline" | "done" | "error";

export interface SyncProgress {
  phase: SyncPhase;
  current: number;
  total: number;
  percent: number;
  error?: string;
}

export interface SessionStatus {
  authenticated: boolean;
  mode: string;
  vid?: string;
}

export function bookStatusLabel(book: ShelfBook): string {
  if (book.finished) return `读完 · ${book.finishedAt ?? ""}`;
  if (book.abandoned) return `弃读 · 读到 ${Math.round(book.progress)}%`;
  if (book.progress === 0) return "想读 · 尚未翻开";
  return `在读 ${Math.round(book.progress)}% · 上次阅读 ${book.lastReadAt ?? ""}`;
}
