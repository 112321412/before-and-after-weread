import { db } from "../db.js";
import { generateJSON, llmState } from "../llm.js";
import type { BookInfoResponse, ChapterInfoResponse, GatewayClient, ReviewListResponse } from "../gateway.js";
import { createMockGateway } from "../mock/gateway.js";
import { keywordsOf } from "../mock/bookstore.js";
import { materializeReviews } from "../mock/reviews.js";
import { normalizeRating, resolveWordCount } from "../reading.js";
import type { Session } from "../sync.js";
import { applyGates, ruleVerdict, type GateInput } from "./gates.js";
import { expandKeywordsRules, parseIntentRules } from "./rules.js";
import { consolidateThemes, findControversy, type RawReview, type ThemeCandidate } from "./themes.js";
import type {
  Candidate,
  CandidatesResult,
  Constraints,
  DecisionCard,
  GoalType,
  IntentResult,
  ThemeBlock
} from "./types.js";

const MODE = process.env.WEREAD_MODE === "real" ? "real" : "mock";
const RATING_COUNT_FLOOR = 50; // 粗筛的评分人数下限（保证书评样本可用）
const DEFAULT_WEEKLY_HOURS = 3;

// mock 会话没有真实网关，决策数据同样从 GatewayClient 形状的内存网关取（与 real 同一条管道）
function decideGateway(session: Session): GatewayClient {
  return session.gateway ?? createMockGateway();
}

function useLlm(): boolean {
  return MODE === "real" && llmState() === "real";
}

// ---- F1.1 意图解析 ----

export async function parseIntent(input: string): Promise<IntentResult> {
  if (!useLlm()) return parseIntentRules(input);
  const result = await generateJSON<{
    goal_type: string;
    topic: string;
    ambiguous: boolean;
    followup_chips: string[];
    constraints: { weekly_hours?: number; time_budget_hours?: number; difficulty?: string; deadline?: string };
  }>(
    "你是读书目标解析器。把用户的一句话解析为结构化 JSON：goal_type ∈ solve_problem/systematic/counter_view/relax/follow_topic/revisit；topic 是主题词或书名；目标含糊到无法判定 goal_type 时 ambiguous=true 并给 followup_chips（可点选项，≤6 个）。constraints 只填用户明确说过的。只输出 JSON。",
    input
  );
  const goalTypes: GoalType[] = ["solve_problem", "systematic", "counter_view", "relax", "follow_topic", "revisit"];
  const goalType = goalTypes.includes(result.goal_type as GoalType) ? (result.goal_type as GoalType) : "solve_problem";
  const constraints: Constraints = {};
  if (result.constraints?.weekly_hours) constraints.weeklyHours = result.constraints.weekly_hours;
  if (result.constraints?.time_budget_hours) constraints.timeBudgetHours = result.constraints.time_budget_hours;
  if (result.constraints?.difficulty) constraints.difficulty = result.constraints.difficulty;
  if (result.constraints?.deadline) constraints.deadline = result.constraints.deadline;
  return {
    mode: result.ambiguous ? "ambiguous" : result.topic.startsWith("《") ? "book" : "topic",
    goalType,
    topic: result.topic.replace(/[《》]/g, ""),
    verbatim: input,
    constraints,
    followupChips: result.ambiguous ? result.followup_chips : undefined,
    llm: "llm"
  };
}

// ---- F1.2 候选圈定 ----

interface ShelfRow {
  book_id: string;
  title: string;
  author: string;
  meta: string;
  progress: number;
  finished: number;
  abandoned: number;
  archive: string | null;
}

export function loadShelfRows(vid: string): ShelfRow[] {
  return db
    .prepare(
      `SELECT s.book_id, s.progress, s.finished, s.abandoned, s.archive, c.title, c.author, c.meta
       FROM shelf_snapshot s JOIN book_cache c ON c.book_id = s.book_id WHERE s.vid = ?`
    )
    .all(vid) as ShelfRow[];
}

export async function buildCandidates(
  session: Session,
  intent: IntentResult,
  offset: number
): Promise<CandidatesResult> {
  const gateway = decideGateway(session);
  const keywords = useLlm()
    ? (await generateJSON<{ keywords: string[] }>(
        "你是图书检索关键词扩展器。把主题扩展为 3-5 个搜索词（同义/下位词），输出 {keywords:[...]}。只输出 JSON。",
        intent.topic
      )).keywords.slice(0, 5)
    : expandKeywordsRules(intent.topic);

  // 逐关键词搜索，累计每本书命中的关键词数（排序依据）
  const matchedKeywords = new Map<string, Set<string>>();
  const meta = new Map<string, { title: string; author: string; intro: string; rating: number; ratingCount: number }>();
  for (const keyword of keywords.slice(0, 5)) {
    const search = await gateway.fetchStoreSearch(keyword);
    for (const group of search.results) {
      for (const entry of group.books) {
        const set = matchedKeywords.get(entry.bookInfo.bookId) ?? new Set<string>();
        set.add(keyword);
        matchedKeywords.set(entry.bookInfo.bookId, set);
        meta.set(entry.bookInfo.bookId, {
          title: entry.bookInfo.title,
          author: entry.bookInfo.author ?? "",
          intro: entry.bookInfo.intro ?? "",
          rating: normalizeRating(entry.newRating),
          ratingCount: entry.newRatingCount ?? 0
        });
      }
    }
  }

  // 相似书补充：以命中关键词最多的书为种子
  const seedBookId = [...matchedKeywords.entries()].sort((a, b) => b[1].size - a[1].size)[0]?.[0];
  const similarSource = new Set<string>();
  if (seedBookId) {
    const similar = await gateway.fetchSimilar(seedBookId);
    for (const entry of similar.booksimilar.books) {
      if (matchedKeywords.has(entry.book.bookInfo.bookId)) continue;
      similarSource.add(entry.book.bookInfo.bookId);
      matchedKeywords.set(entry.book.bookInfo.bookId, new Set(["similar"]));
      meta.set(entry.book.bookInfo.bookId, {
        title: entry.book.bookInfo.title,
        author: entry.book.bookInfo.author ?? "",
        intro: entry.book.bookInfo.intro ?? "",
        rating: 0,
        ratingCount: 0
      });
    }
  }

  const shelfRows = loadShelfRows(session.vid);
  const shelfByBookId = new Map(shelfRows.map((row) => [row.book_id, row]));
  let filteredCount = 0;
  const ranked = [...matchedKeywords.entries()]
    .filter(([bookId, keywordSet]) => {
      const info = meta.get(bookId)!;
      if (!similarSource.has(bookId) && info.ratingCount < RATING_COUNT_FLOOR) {
        filteredCount += 1; // 评分人数下限：书评样本不可用的书不进候选
        return false;
      }
      const shelfRow = shelfByBookId.get(bookId);
      if (shelfRow?.finished && intent.goalType !== "revisit") {
        filteredCount += 1; // 已读剔除（重读目标除外）
        return false;
      }
      return keywordSet.size > 0;
    })
    .sort((a, b) => {
      const ratingA = meta.get(a[0])!.rating;
      const ratingB = meta.get(b[0])!.rating;
      return b[1].size - a[1].size || ratingB - ratingA;
    });

  const page = ranked.slice(offset * 5, offset * 5 + 5);
  await Promise.all(
    page
      .filter(([bookId]) => {
        const info = meta.get(bookId)!;
        return similarSource.has(bookId) && (info.rating <= 0 || info.intro.trim() === "");
      })
      .map(async ([bookId]) => {
        const current = meta.get(bookId)!;
        try {
          const detail = await gateway.fetchBookInfo(bookId);
          meta.set(bookId, {
            ...current,
            title: detail.title || current.title,
            author: detail.author || current.author,
            intro: current.intro || detail.intro || "",
            rating: detail.newRating === undefined ? current.rating : normalizeRating(detail.newRating),
            ratingCount: detail.newRatingCount ?? current.ratingCount
          });
        } catch {
          // 单本详情失败只保留相似接口的基本字段，不拖垮候选页。
        }
      })
  );
  const candidates: Candidate[] = page.map(([bookId]) => {
    const info = meta.get(bookId)!;
    return {
      bookId,
      title: info.title,
      author: info.author,
      rating: info.rating,
      ratingCount: info.ratingCount,
      intro: info.intro,
      source: similarSource.has(bookId) ? "similar" : "search",
      dupNote: dupNoteFor(shelfByBookId.get(bookId))
    };
  });

  return {
    keywords,
    candidates,
    preselected: candidates.slice(0, 3).map((candidate) => candidate.bookId),
    filteredCount,
    offset,
    hasMore: ranked.length > (offset + 1) * 5
  };
}

function dupNoteFor(row: ShelfRow | undefined): string | null {
  if (!row) return null;
  if (row.abandoned) return `曾读到 ${Math.round(row.progress)}% 弃读`;
  if (row.progress > 0) return `在你的书架上（在读 ${Math.round(row.progress)}%）`;
  if (row.archive === "想读") return "已在你的想读书单";
  return null;
}

// 书目式入口：《书名》值得读吗 → 先解析 bookId
export async function resolveBookByTitle(session: Session, title: string): Promise<string | null> {
  const search = await decideGateway(session).fetchStoreSearch(title);
  for (const group of search.results) {
    const exact = group.books.find((entry) => entry.bookInfo.title === title);
    if (exact) return exact.bookInfo.bookId;
  }
  return search.results[0]?.books[0]?.bookInfo.title === title ? search.results[0].books[0].bookInfo.bookId : null;
}

// ---- F1.3 决策卡 ----

type BookStyle = "theory" | "practical" | "popular" | "narrative" | "essay";

const MATCH_TABLE: Record<GoalType, Record<BookStyle, number>> = {
  solve_problem: { practical: 5, popular: 4, theory: 2, narrative: 1, essay: 2 },
  systematic: { theory: 5, popular: 4, practical: 3, essay: 3, narrative: 2 },
  counter_view: { theory: 4, essay: 4, popular: 3, practical: 2, narrative: 2 },
  relax: { narrative: 5, essay: 4, popular: 3, theory: 1, practical: 2 },
  follow_topic: { popular: 5, essay: 3, theory: 3, practical: 3, narrative: 3 },
  revisit: { theory: 4, practical: 4, popular: 4, narrative: 4, essay: 4 }
};

const ARGUMENT_STYLE_LABELS: Record<BookStyle, string> = {
  theory: "理论推演",
  practical: "案例驱动",
  popular: "数据论证",
  narrative: "叙事",
  essay: "综论"
};

function detectStyle(chapterTitles: string[]): BookStyle {
  const text = chapterTitles.join(" ");
  if (/案例|清单|诊断|实操|落地|杠杆|工具/.test(text)) return "practical";
  if (/数据|实验|统计/.test(text)) return "popular";
  if (/尾声|来客|雨季|撤离|书信/.test(text)) return "narrative";
  if (/谱系|理论|转向|导论|学理|研究|比较/.test(text)) return "theory";
  return "essay";
}

const cardCache = new Map<string, DecisionCard>();

type ReviewBand = "recommend" | "negative" | "neutral";

const REVIEW_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REVIEW_LIST_TYPES: Record<ReviewBand, 1 | 2 | 4> = {
  recommend: 1,
  negative: 2,
  neutral: 4
};

interface ReviewCacheRow {
  reviews: string;
  snapshot_date: string;
}

export interface CachedReviewList {
  response: ReviewListResponse;
  snapshotDate: string;
}

export async function fetchReviewListCachedWithDate(
  gateway: GatewayClient,
  bookId: string,
  band: ReviewBand
): Promise<CachedReviewList> {
  const row = db
    .prepare(`SELECT reviews, snapshot_date FROM review_cache WHERE book_id = ? AND band = ?`)
    .get(bookId, band) as ReviewCacheRow | undefined;
  const age = row ? Date.now() - Date.parse(row.snapshot_date) : Number.POSITIVE_INFINITY;
  if (row && Number.isFinite(age) && age < REVIEW_CACHE_TTL_MS) {
    return { response: JSON.parse(row.reviews) as ReviewListResponse, snapshotDate: row.snapshot_date };
  }

  const response = await gateway.fetchReviewList(bookId, REVIEW_LIST_TYPES[band]);
  const snapshotDate = new Date().toISOString();
  db.prepare(
    `INSERT INTO review_cache (book_id, band, reviews, snapshot_date)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(book_id, band) DO UPDATE SET
        reviews = excluded.reviews,
        snapshot_date = excluded.snapshot_date`
  ).run(bookId, band, JSON.stringify(response), snapshotDate);
  return { response, snapshotDate };
}

export async function fetchReviewListCached(
  gateway: GatewayClient,
  bookId: string,
  band: ReviewBand
): Promise<ReviewListResponse> {
  return (await fetchReviewListCachedWithDate(gateway, bookId, band)).response;
}

interface BookCacheMetadata {
  category?: string;
  bookInfo?: BookInfoResponse;
  chapters?: ChapterInfoResponse["chapters"];
}

interface BookMetadata {
  bookInfo: BookInfoResponse;
  chapterInfo: ChapterInfoResponse;
}

function normalizeBookInfo(bookInfo: BookInfoResponse): BookInfoResponse {
  return { ...bookInfo, newRating: normalizeRating(bookInfo.newRating) };
}

function readBookMetadata(bookId: string): BookMetadata | null {
  const row = db.prepare(`SELECT title, author, meta FROM book_cache WHERE book_id = ?`).get(bookId) as
    | { title: string; author: string | null; meta: string }
    | undefined;
  if (!row) return null;
  let metadata: BookCacheMetadata;
  try {
    metadata = JSON.parse(row.meta) as BookCacheMetadata;
  } catch {
    return null;
  }
  const info = metadata.bookInfo;
  if (!info || typeof info.wordCount !== "number" || !Array.isArray(metadata.chapters)) return null;
  const bookInfo = normalizeBookInfo({ ...info, bookId, title: row.title, author: row.author ?? info.author ?? "" });
  return {
    bookInfo,
    chapterInfo: { bookId, chapters: metadata.chapters }
  };
}

function writeBookMetadata(bookInfo: BookInfoResponse, chapterInfo: ChapterInfoResponse): void {
  const normalizedBookInfo = normalizeBookInfo(bookInfo);
  const existing = db.prepare(`SELECT meta FROM book_cache WHERE book_id = ?`).get(normalizedBookInfo.bookId) as { meta: string } | undefined;
  let previous: BookCacheMetadata = {};
  try {
    if (existing) previous = JSON.parse(existing.meta) as BookCacheMetadata;
  } catch {
    // 旧缓存元数据损坏时，用本次完整回包覆盖。
  }
  const metadata: BookCacheMetadata = {
    ...previous,
    category: normalizedBookInfo.category ?? previous.category,
    bookInfo: normalizedBookInfo,
    chapters: chapterInfo.chapters
  };
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO book_cache (book_id, title, author, meta, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET title = excluded.title, author = excluded.author,
       meta = excluded.meta, fetched_at = excluded.fetched_at`
  ).run(normalizedBookInfo.bookId, normalizedBookInfo.title, normalizedBookInfo.author ?? "", JSON.stringify(metadata), now);
}

async function loadOrFetchBookMetadata(gateway: GatewayClient, bookId: string): Promise<BookMetadata> {
  const cached = readBookMetadata(bookId);
  if (cached) return cached;
  const [bookInfo, chapterInfo] = await Promise.all([gateway.fetchBookInfo(bookId), gateway.fetchChapterInfo(bookId)]);
  const normalizedBookInfo = normalizeBookInfo(bookInfo);
  writeBookMetadata(normalizedBookInfo, chapterInfo);
  return { bookInfo: normalizedBookInfo, chapterInfo };
}

function toRawReviews(response: ReviewListResponse): RawReview[] {
  return response.reviews.map((entry) => ({
    reviewId: entry.review.review.reviewId,
    content: entry.review.review.content,
    star: entry.review.review.star,
    isFinish: entry.review.review.isFinish === 1,
    createTime: entry.review.review.createTime
  }));
}

// 主题候选来源：mock = fixture 标注；real+LLM = 归纳；real 未配 LLM = 无（降级为个别提及）
function fixtureThemeCandidates(bookId: string, band: "recommend" | "neutral" | "negative", reviews: RawReview[]): ThemeCandidate[] {
  const idSet = new Set(reviews.map((review) => review.reviewId));
  const grouped = new Map<string, string[]>();
  for (const review of materializeReviews(bookId, band)) {
    if (!idSet.has(review.reviewId)) continue;
    const ids = grouped.get(review.theme) ?? [];
    ids.push(review.reviewId);
    grouped.set(review.theme, ids);
  }
  return [...grouped.entries()].map(([theme, reviewIds]) => ({ theme, reviewIds }));
}

async function llmThemeCandidates(bandLabel: string, reviews: RawReview[]): Promise<ThemeCandidate[]> {
  const result = await generateJSON<{ themes: { theme: string; review_ids: string[] }[] }>(
    "你是书评主题归纳器。把书评按谈论的同一件事聚类成 3-6 个主题，每个主题列出支持它的书评 id。主题名 ≤6 字。输出 {themes:[{theme, review_ids}]}。只输出 JSON。",
    `以下是 20 条${bandLabel}书评：\n${reviews.map((review) => `${review.reviewId}: ${review.content}`).join("\n")}`
  );
  return result.themes.map((theme) => ({ theme: theme.theme, reviewIds: theme.review_ids }));
}

export async function buildCard(session: Session, bookId: string, intent: IntentResult): Promise<DecisionCard> {
  const gateway = decideGateway(session);
  const [{ bookInfo, chapterInfo }, bestBookmarks, recommendCached, negativeCached, neutralCached, similarRes] = await Promise.all([
    loadOrFetchBookMetadata(gateway, bookId),
    gateway.fetchBestBookmarks(bookId),
    fetchReviewListCachedWithDate(gateway, bookId, "recommend"),
    fetchReviewListCachedWithDate(gateway, bookId, "negative"),
    fetchReviewListCachedWithDate(gateway, bookId, "neutral"),
    gateway.fetchSimilar(bookId)
  ]);
  const recommendRes = recommendCached.response;
  const negativeRes = negativeCached.response;
  const neutralRes = neutralCached.response;
  const reviewSnapshotDates = [recommendCached.snapshotDate, negativeCached.snapshotDate, neutralCached.snapshotDate]
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  const reviewSnapshotDate = reviewSnapshotDates.length > 0
    ? new Date(Math.min(...reviewSnapshotDates)).toISOString()
    : null;

  const chapters = chapterInfo.chapters;
  const style = detectStyle(chapters.map((chapter) => chapter.title));
  const matchScore = MATCH_TABLE[intent.goalType][style];
  const difficultyConstraint = intent.constraints.difficulty === "低学术门槛";
  const mismatch = matchScore <= 2 && difficultyConstraint;

  // 速度基线 → 阅读成本
  const baseline = db
    .prepare(`SELECT words_per_minute, basis FROM speed_baseline WHERE vid = ?`)
    .get(session.vid) as { words_per_minute: number; basis: string } | undefined;
  const wpm = baseline?.words_per_minute ?? 425;
  const effectiveWordCount = resolveWordCount(bookInfo.wordCount, chapters.map((chapter) => chapter.wordCount));
  const wordCountSource: DecisionCard["readingCost"]["wordCountSource"] =
    bookInfo.wordCount > 0 ? "book_info" : effectiveWordCount > 0 ? "chapters" : "unknown";
  const estimatedHours = effectiveWordCount > 0 ? effectiveWordCount / wpm / 60 : null;
  const estimatedHoursForRules = estimatedHours ?? 0;
  const weeklyHours = intent.constraints.weeklyHours ?? DEFAULT_WEEKLY_HOURS;
  const timeBudgetHours = intent.constraints.timeBudgetHours ?? weeklyHours * 3;
  const weeks = estimatedHours === null ? null : Math.max(1, Math.ceil(estimatedHours / weeklyHours));

  // 评论三档 → P1 主题归纳
  const bandData = [
    { band: "recommend" as const, label: "好评", response: recommendRes },
    { band: "neutral" as const, label: "一般", response: neutralRes },
    { band: "negative" as const, label: "差评", response: negativeRes }
  ];
  const themeBlocks: Record<string, { themes: ThemeBlock[]; singles: ThemeBlock["quotes"] }> = {};
  const llmOn = useLlm();
  for (const entry of bandData) {
    const reviews = toRawReviews(entry.response);
    const candidates = MODE === "mock"
      ? fixtureThemeCandidates(bookId, entry.band, reviews)
      : llmOn
        ? await llmThemeCandidates(entry.label, reviews)
        : [];
    themeBlocks[entry.band] = consolidateThemes(candidates, reviews, entry.label);
  }
  const negativeThemes = themeBlocks.negative.themes;
  const themeNegativeMajor = negativeThemes.some((theme) => theme.count >= Math.max(3, Math.ceil(theme.total * 0.3)));

  // 个人关联（与书架比对）
  const shelfRows = loadShelfRows(session.vid);
  const cardShelfRow = shelfRows.find((row) => row.book_id === bookId);
  const topicTerms = extractTerms(intent.topic);
  // 重复度看两条线：目标主题词、候选书自身关键词，任一与在读书/已读书重叠 ≥2 即高重复。
  // 只比书名与关键词不比分类名；重叠数按去重词计（同一词重复出现只算一次）
  const candidateTerms = new Set([
    ...extractTerms(bookInfo.title),
    ...(MODE === "mock" ? keywordsOf(bookId) : [])
  ]);
  const goalTerms = new Set(topicTerms);
  const duplicationWith = shelfRows.find((row) => {
    if (row.book_id === bookId || (row.finished !== 1 && row.progress === 0)) return false;
    const rowTerms = new Set(extractTerms(row.title).concat(keywordsOf(row.book_id)));
    const topicOverlap = [...goalTerms].filter((term) => rowTerms.has(term)).length;
    const candidateOverlap = [...candidateTerms].filter((term) => rowTerms.has(term)).length;
    return Math.max(topicOverlap, candidateOverlap) >= 2;
  });
  const authorHistory = shelfRows.find(
    (row) => row.finished === 1 && row.author === bookInfo.author && row.book_id !== bookId
  );
  const sameCategoryFinished = shelfRows.filter(
    (row) => row.finished === 1 && row.book_id !== bookId && JSON.parse(row.meta).category === bookInfo.category
  );

  // F1.4 闸门 + 裁量
  const gateInput: GateInput = {
    matchScore,
    mismatch,
    estimatedHours: estimatedHoursForRules,
    timeBudgetHours,
    duplicationHigh: Boolean(duplicationWith),
    themeNegativeMajor
  };
  const gates = applyGates(gateInput);
  let verdict = ruleVerdict(gates, {
    duplicationHigh: gateInput.duplicationHigh,
    themeNegativeMajor,
    estimatedHours: estimatedHoursForRules
  });
  let llmSource: "llm" | "rules" = "rules";
  if (llmOn) {
    const weighed = await generateJSON<{ action: string; one_liner: string; shelve_trigger?: string }>(
      "你是读前判定器。在允许的动作内权衡，给出 action/one_liner（≤30字）/shelve_trigger（action=shelve 时必填，“当…时再读”）。输出 JSON。",
      JSON.stringify({
        允许的动作: gates.allowed,
        目标: intent.verbatim,
        书名: bookInfo.title,
        匹配分: `${matchScore}/5`,
        预计时长小时: estimatedHoursForRules.toFixed(1),
        时间预算小时: timeBudgetHours,
        主题级差评: negativeThemes.map((theme) => theme.theme),
        与在读书重复: gateInput.duplicationHigh
      })
    );
    if (gates.allowed.includes(weighed.action as "read_now" | "shelve" | "skip")) {
      llmSource = "llm";
      verdict = {
        action: weighed.action as "read_now" | "shelve" | "skip",
        oneLiner: weighed.one_liner.slice(0, 30),
        shelveTrigger: weighed.action === "shelve" ? (weighed.shelve_trigger ?? "时间宽裕时") : null
      };
    }
  }
  if (verdict.action === "shelve" && !verdict.shelveTrigger) {
    verdict.shelveTrigger = "时间宽裕、想要体系梳理时";
  }

  // 置信度：三块证据方向一致性；规则判定（未接 LLM）封顶 medium
  const openQuestions: string[] = [];
  if ((bookInfo.newRatingCount ?? 0) < 100) openQuestions.push("评分人数较少，评论分歧统计的代表性有限");
  if (effectiveWordCount === 0) openQuestions.push("有效字数缺失，预计时长待校准");
  if (!llmOn && MODE === "real") openQuestions.push("未接入 LLM：评论主题未归纳，判定仅含闸门规则");
  if (mismatch && negativeThemes.length === 0) openQuestions.push("缺少书评样本佐证错配判断");
  let confidence: "high" | "medium" | "low" = "medium";
  if (openQuestions.length >= 2) confidence = "low";
  else if (gates.floorReadNow && !themeNegativeMajor && !duplicationWith) confidence = "high";
  if (llmSource === "rules" && confidence === "high") confidence = "medium";

  // F1.5 剧透控制
  const storedSpoilerLevel = (db.prepare(`SELECT spoiler_level FROM user_settings WHERE vid = ?`).get(session.vid) as { spoiler_level?: string } | undefined)?.spoiler_level;
  const spoilerLevel = storedSpoilerLevel === "light" || storedSpoilerLevel === "full" ? storedSpoilerLevel : "none";
  const isNarrative = /小说|文学/.test(bookInfo.category ?? "") || style === "narrative";
  const chapterCount = Math.max(1, chapters.length);
  const contentSample = isNarrative
    ? { bookmarksHidden: true, note: "小说/文学类默认无剧透档：内容样本仅保留问题与形式描述，热门划线不展示", bookmarks: [] }
    : {
        bookmarksHidden: false,
        note:
          spoilerLevel === "none"
            ? "无剧透档：结论型划线默认折叠"
            : spoilerLevel === "light"
              ? "轻剧透档：结论型划线默认折叠"
              : "全剧透档：热门划线全部展示",
        bookmarks: bestBookmarks.items.map((item) => {
          const chapterIdx = chapterInfo.chapters.find((chapter) => chapter.chapterUid === item.chapterUid)?.chapterIdx ?? 0;
          const kind = chapterIdx >= chapterCount * 0.7 ? "结论" : "金句";
          return {
            text: item.markText,
            kind: spoilerLevel === "full" ? "金句" : (kind as "金句" | "结论"),
            totalCount: item.totalCount
          };
        })
      };

  // 替代方案（verdict 非 read_now 时必给）
  const alternative =
    verdict.action === "read_now"
      ? []
      : similarRes.booksimilar.books.slice(0, 2).map((entry) => ({
          title: entry.book.bookInfo.title,
          why:
            estimatedHoursForRules > 12
              ? "同主题但更轻，先读它再决定要不要啃大部头"
              : gateInput.duplicationHigh
                ? "先读完你在读的同主题书，再考虑这本"
                : "评分相近的同主题备选"
        }));

  const difficulty = themeBlocks.neutral.themes.some((theme) => theme.theme.includes("门槛"))
    ? "有门槛：一般档书评集中提到术语密度与前置知识要求"
    : difficultyConstraint && style === "theory"
      ? "偏学理：章节结构以理论谱系为主，方法/工具密度低"
      : "门槛适中，可直接进入";
  const versionNote = [...themeBlocks.neutral.themes, ...negativeThemes].some((theme) => theme.theme.includes("翻译"))
    ? "多位读者提到译文生硬、术语前后不一致"
    : null;

  const cardId = `dc_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const card: DecisionCard = {
    cardId,
    book: {
      bookId,
      title: bookInfo.title,
      author: bookInfo.author ?? "",
      category: bookInfo.category ?? "",
      deepLink: bookInfo.deepLink ?? null,
      wordCount: effectiveWordCount,
      rating: normalizeRating(bookInfo.newRating),
      ratingCount: bookInfo.newRatingCount ?? 0
    },
    userGoal: { type: intent.goalType, verbatim: intent.verbatim, constraints: intent.constraints },
    llm: llmSource,
    verdict: { action: verdict.action, confidence, oneLiner: verdict.oneLiner, shelveTrigger: verdict.shelveTrigger },
    contentMatch: {
      coreQuestion: coreQuestionFrom(intro(bookInfo.intro), chapters.map((chapter) => chapter.title)),
      argumentStyle: ARGUMENT_STYLE_LABELS[style],
      styleEvidence: `目录结构（${chapters.length} 章）以「${chapters[0]?.title ?? ""}」开篇，${ARGUMENT_STYLE_LABELS[style]}特征明显`,
      matchScore,
      mismatchWarning: mismatch
        ? `目标是「${intent.goalType === "solve_problem" ? "解决具体问题" : intent.goalType}」，但本书以理论谱系为主、方法密度低`
        : null
    },
    readingCost: {
      estimatedHours: estimatedHours === null ? null : Math.round(estimatedHours * 10) / 10,
      wordCountSource,
      speedBasis: baseline?.basis === "own_median" ? "own" : "estimated",
      calendarEstimate:
        estimatedHours === null
          ? `暂无有效字数，预计时长待校准${intent.constraints.deadline ? `（你的期限：${intent.constraints.deadline}）` : ""}`
          : `按每周 ${weeklyHours} 小时，约 ${weeks} 周${intent.constraints.deadline ? `（你的期限：${intent.constraints.deadline}）` : ""}`,
      difficulty,
      versionNote
    },
    reviewDivergence: {
      snapshotDate: reviewSnapshotDate,
      rating: normalizeRating(bookInfo.newRating),
      ratingCount: bookInfo.newRatingCount ?? 0,
      deepVRecommend: recommendRes.deepVRecommendValue ? `${normalizeRating(recommendRes.deepVRecommendValue).toFixed(1)}%` : null,
      positiveThemes: themeBlocks.recommend.themes,
      neutralThemes: themeBlocks.neutral.themes,
      negativeThemes,
      singles: [...themeBlocks.recommend.singles, ...themeBlocks.neutral.singles, ...themeBlocks.negative.singles].slice(0, 3),
      controversy: findControversy(themeBlocks.recommend.themes, negativeThemes)
    },
    personalLink: {
      relations: sameCategoryFinished.slice(0, 2).map((row) => {
        const rowTerms = new Set(keywordsOf(row.book_id));
        const overlap = topicTerms.filter((term) => rowTerms.has(term)).length;
        return {
          type: overlap >= 2 ? "重复" : intent.goalType === "systematic" ? "前置" : "补充",
          book: row.title,
          note: overlap >= 2 ? "主题高度重叠，读完一本再看另一本收益更高" : "同分类已读，可作为背景互证"
        };
      }),
      alreadyIn: alreadyInFor(cardShelfRow),
      authorHistory: authorHistory ? `你读过该作者的《${authorHistory.title}》` : null
    },
    alternative,
    contentSample,
    gatesHit: gates.gatesHit,
    openQuestions
  };

  cardCache.set(cardId, card);
  if (cardCache.size > 30) {
    cardCache.delete(cardCache.keys().next().value as string);
  }
  return card;
}

function intro(text: string | undefined): string {
  return text ?? "";
}

function coreQuestionFrom(bookIntro: string, chapterTitles: string[]): string {
  const firstSentence = bookIntro.split(/。/)[0];
  if (firstSentence.length >= 8) return firstSentence.slice(0, 40);
  return chapterTitles.length > 1 ? `全书围绕「${chapterTitles[1] ?? chapterTitles[0]}」展开` : "简介缺失，核心问题待读后确认";
}

function alreadyInFor(row: ShelfRow | undefined): string | null {
  if (!row) return null;
  if (row.finished) return "你已读完这本书，本次判定按重读口径";
  if (row.abandoned) return `召回：你曾读到 ${Math.round(row.progress)}% 弃读`;
  if (row.progress > 0) return `你正在读这本书（${Math.round(row.progress)}%）`;
  if (row.archive === "想读") return "已在你的想读书单";
  return null;
}

// 中文 2 字滑窗取词，用于主题重叠判断
function extractTerms(text: string): string[] {
  const terms: string[] = [];
  for (let i = 0; i < text.length - 1; i += 1) {
    terms.push(text.slice(i, i + 2));
  }
  return terms;
}

// ---- F1.6 决策动作与档案 ----

export interface DecisionRecordInput {
  cardId: string;
  action: "read_now" | "shelve" | "skip";
  trigger?: string;
  reason?: string;
}

export interface RejudgeDecisionInput {
  action: DecisionRecordInput["action"];
  trigger?: string;
  reason?: string;
}

interface StoredDecisionPayload {
  card: DecisionCard;
  trigger?: string | null;
  reason?: string | null;
}

interface DecisionRow {
  id: number;
  topic: string | null;
  verdict: string;
  action: string | null;
  action_time: number | null;
  card_json: string;
}

export function recordDecision(vid: string, input: DecisionRecordInput): void {
  const card = cardCache.get(input.cardId);
  if (!card) throw new Error("决策卡已过期（重启服务或超过缓存上限），请重新生成后再操作");
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO decision_record (vid, created_at, goal, topic, card_json, verdict, action, action_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    vid,
    now,
    card.userGoal.type,
    card.userGoal.verbatim,
    JSON.stringify({ card, trigger: input.trigger ?? null, reason: input.reason ?? null }),
    card.verdict.action,
    input.action,
    now
  );
}

function decisionRows(vid: string): DecisionRow[] {
  return db
    .prepare(`SELECT id, topic, verdict, action, action_time, card_json FROM decision_record WHERE vid = ? ORDER BY id DESC`)
    .all(vid) as DecisionRow[];
}

function parseStoredDecision(row: DecisionRow): StoredDecisionPayload | null {
  try {
    const payload = JSON.parse(row.card_json) as StoredDecisionPayload;
    return payload.card?.cardId && payload.card.book?.bookId ? payload : null;
  } catch {
    return null;
  }
}

export interface DecisionHistoryItem {
  id: number;
  cardId: string;
  bookId: string;
  title: string;
  topic: string | null;
  verdict: string;
  action: string | null;
  trigger: string | null;
  reason: string | null;
  createdAt: number;
}

export function listDecisions(vid: string): DecisionHistoryItem[] {
  return decisionRows(vid)
    .map((row) => {
      const payload = parseStoredDecision(row);
      if (!payload) return null;
      return {
        id: row.id,
        cardId: payload.card.cardId,
        bookId: payload.card.book.bookId,
        title: payload.card.book.title,
        topic: row.topic,
        verdict: row.verdict,
        action: row.action,
        trigger: payload.trigger ?? null,
        reason: payload.reason ?? null,
        createdAt: row.action_time ?? 0
      };
    })
    .filter((row): row is DecisionHistoryItem => row !== null)
    .slice(0, 20);
}

export function rejudgeDecision(vid: string, recordId: number, input: RejudgeDecisionInput): void {
  const row = db
    .prepare(`SELECT id, topic, verdict, action, action_time, card_json FROM decision_record WHERE id = ? AND vid = ?`)
    .get(recordId, vid) as DecisionRow | undefined;
  const payload = row ? parseStoredDecision(row) : null;
  if (!row || !payload) throw new Error("决策记录不存在");
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO decision_record (vid, created_at, goal, topic, card_json, verdict, action, action_time)
     SELECT vid, ?, goal, topic, ?, verdict, ?, ? FROM decision_record WHERE id = ? AND vid = ?`
  ).run(
    now,
    JSON.stringify({ card: payload.card, trigger: input.trigger ?? null, reason: input.reason ?? null }),
    input.action,
    now,
    recordId,
    vid
  );
}

export interface ReadingListItem {
  recordId: number;
  cardId: string;
  bookId: string;
  title: string;
  author: string;
  trigger: string | null;
  updatedAt: number;
}

export function listReadingList(vid: string): ReadingListItem[] {
  const seenBooks = new Set<string>();
  const items: ReadingListItem[] = [];
  for (const row of decisionRows(vid)) {
    const payload = parseStoredDecision(row);
    if (!payload) continue;
    const book = payload.card.book;
    if (seenBooks.has(book.bookId)) continue;
    seenBooks.add(book.bookId);
    if (row.action !== "shelve") continue;
    items.push({
      recordId: row.id,
      cardId: payload.card.cardId,
      bookId: book.bookId,
      title: book.title,
      author: book.author,
      trigger: payload.trigger ?? null,
      updatedAt: row.action_time ?? 0
    });
  }
  return items;
}
