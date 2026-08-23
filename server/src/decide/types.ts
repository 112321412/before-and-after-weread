// 决策引擎类型：字段对齐 docs/decision-card-spec.md
export type GoalType =
  | "solve_problem" // 解决具体问题
  | "systematic" // 系统入门
  | "counter_view" // 找反方观点
  | "relax" // 消遣放松
  | "follow_topic" // 跟上话题
  | "revisit"; // 重读

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
  topic: string; // 主题式=主题词，书目式=书名
  verbatim: string;
  constraints: Constraints;
  followupChips?: string[];
  resolvedBookId?: string; // 书目式：服务端解析出的 bookId，直接跳候选/卡片
  llm: "llm" | "rules"; // 意图解析来源（mock/degraded 均为 rules）
}

export interface Candidate {
  bookId: string;
  title: string;
  author: string;
  rating: number;
  ratingCount: number;
  intro: string;
  source: "search" | "similar";
  dupNote: string | null; // 书架去重提示（在读/想读/曾弃读）
}

export interface CandidatesResult {
  keywords: string[];
  candidates: Candidate[];
  preselected: string[]; // 预勾选的 bookId
  filteredCount: number; // 粗筛剔除数量（评分人数下限 + 已读去重）
  offset: number;
  hasMore: boolean;
}

export interface Quote {
  text: string;
  star: number;
  isFinish: boolean;
  highWeight: boolean; // “读完仍差评”是 P1 高权重信号（仅差评档）
}

export interface ThemeBlock {
  theme: string;
  count: number;
  total: number;
  display: string; // 展示口径：“20 条抽样差评中 5 条提及”
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
  llm: "llm" | "rules"; // rules 时卡面明示“未接入 LLM，判定仅含闸门规则”
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
    bookmarksHidden: boolean; // 小说类按 F1.5 隐藏热门划线
    note: string | null;
    bookmarks: { text: string; kind: "金句" | "结论"; totalCount: number }[];
  };
  gatesHit: string[]; // 命中的闸门描述（可回测）
  openQuestions: string[];
}

export interface DecisionAction {
  cardId: string;
  action: "read_now" | "shelve" | "skip";
  trigger?: string; // 放入待读时的触发条件
  reason?: string; // 排除时的理由
}
