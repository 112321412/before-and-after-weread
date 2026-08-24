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
  sync?: SyncProgress;
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

export type SpoilerLevel = "none" | "light" | "full";

export interface SettingsResponse {
  spoilerLevel: SpoilerLevel;
  sync: SyncProgress;
}

// ---- 选书决策（与 server/src/decide/types.ts 对齐）----

export type GoalType = "solve_problem" | "systematic" | "counter_view" | "relax" | "follow_topic" | "revisit";

export const GOAL_LABELS: Record<GoalType, string> = {
  solve_problem: "解决具体问题",
  systematic: "系统入门",
  counter_view: "找反方观点",
  relax: "消遣放松",
  follow_topic: "跟上话题",
  revisit: "重读"
};

export interface Constraints {
  weeklyHours?: number;
  timeBudgetHours?: number;
  difficulty?: string;
  deadline?: string;
}

export interface IntentResult {
  mode: "topic" | "book" | "ambiguous";
  goalType: GoalType;
  topic: string;
  verbatim: string;
  constraints: Constraints;
  followupChips?: string[];
  resolvedBookId?: string;
  llm: "llm" | "rules";
}

export interface Candidate {
  bookId: string;
  title: string;
  author: string;
  rating: number;
  ratingCount: number;
  intro: string;
  source: "search" | "similar";
  dupNote: string | null;
}

export interface CandidatesResult {
  keywords: string[];
  candidates: Candidate[];
  preselected: string[];
  filteredCount: number;
  offset: number;
  hasMore: boolean;
}

export interface Quote {
  text: string;
  star: number;
  isFinish: boolean;
  highWeight: boolean;
}

export interface ThemeBlock {
  theme: string;
  count: number;
  total: number;
  display: string;
  quotes: Quote[];
}

export interface Relation {
  type: "补充" | "重复" | "前置";
  book: string;
  note: string;
}

export interface DecisionCard {
  cardId: string;
  book: {
    bookId: string;
    title: string;
    author: string;
    category: string;
    deepLink: string | null;
    wordCount: number;
    rating: number;
    ratingCount: number;
  };
  userGoal: { type: GoalType; verbatim: string; constraints: Constraints };
  llm: "llm" | "rules";
  verdict: {
    action: "read_now" | "shelve" | "skip";
    confidence: "high" | "medium" | "low";
    oneLiner: string;
    shelveTrigger: string | null;
  };
  contentMatch: {
    coreQuestion: string;
    argumentStyle: string;
    styleEvidence: string;
    matchScore: number;
    mismatchWarning: string | null;
  };
  readingCost: {
    estimatedHours: number;
    speedBasis: "own" | "estimated";
    calendarEstimate: string;
    difficulty: string;
    versionNote: string | null;
  };
  reviewDivergence: {
    snapshotDate: string | null;
    rating: number;
    ratingCount: number;
    deepVRecommend: string | null;
    positiveThemes: ThemeBlock[];
    neutralThemes: ThemeBlock[];
    negativeThemes: ThemeBlock[];
    singles: Quote[];
    controversy: string | null;
  };
  personalLink: {
    relations: Relation[];
    alreadyIn: string | null;
    authorHistory: string | null;
  };
  alternative: { title: string; why: string }[];
  contentSample: {
    bookmarksHidden: boolean;
    note: string | null;
    bookmarks: { text: string; kind: "金句" | "结论"; totalCount: number }[];
  };
  gatesHit: string[];
  openQuestions: string[];
}

export interface DecisionHistoryItem {
  id: number;
  topic: string;
  verdict: string;
  action: string;
  createdAt: number;
}

// ---- 读后整理（与 server/src/review/ 对齐）----

export interface ReviewBookItem {
  bookId: string;
  title: string;
  author: string;
  group: "finished" | "abandoned" | "reading";
  progress: number;
  readMinutes: number;
  lastReadAt: string | null;
  finishedAt: string | null;
  highlights: number;
  thoughts: number;
}

export interface RecallEvidence {
  id: string;
  kind: "highlight" | "thought";
  text: string;
  context: string | null;
  chapterUid: number | null;
  createTime: number;
}

export interface RecallSection {
  title: string;
  paragraphs: string[];
  evidenceIds: string[];
}

export interface EvolutionFact {
  note: string;
  evidenceIds: string[];
}

export interface RecallDraft {
  bookId: string;
  title: string;
  framework: "finished" | "abandoned" | "reading";
  llm: "llm" | "rules";
  headlineNote: string | null;
  sections: RecallSection[];
  evolution: EvolutionFact[];
  evidences: RecallEvidence[];
  meta: {
    progress: number;
    readMinutes: number;
    finishedAt: string | null;
    lastReadAt: string | null;
    highlightCount: number;
    thoughtCount: number;
  };
}

export interface ThemeEvidence extends RecallEvidence {
  bookTitle: string;
}

export interface ThemeGroup {
  title: string;
  summary: string;
  evidenceIds: string[];
}

export interface ThemeResult {
  question: string;
  insufficient: boolean;
  note: string | null;
  totalMatches: number;
  books: string[];
  themes: ThemeGroup[];
  evolution: EvolutionFact[];
  evidences: ThemeEvidence[];
  llm: "llm" | "rules";
}

export interface SessionStatus {
  authenticated: boolean;
  mode: string;
  vid?: string;
  createdAt?: number;
}

export function bookStatusLabel(book: ShelfBook): string {
  if (book.finished) return `读完 · ${book.finishedAt ?? ""}`;
  if (book.abandoned) return `弃读 · 读到 ${Math.round(book.progress)}%`;
  if (book.progress === 0) return "想读 · 尚未翻开";
  return `在读 ${Math.round(book.progress)}% · 上次阅读 ${book.lastReadAt ?? ""}`;
}
