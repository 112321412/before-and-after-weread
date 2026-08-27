import { db } from "../db.js";
import { generateJSON } from "../llm.js";
import { isFinishedReading, readingSeconds } from "../reading.js";
import type { Session } from "../sync.js";

// F2.1 单书回顾：素材严格取自 highlight / thought / shelf_snapshot 三张表，
// 引文原样携带（id 即表内 range），确保验收时每条引文都能查回原文。
export interface Evidence {
  id: string;
  kind: "highlight" | "thought";
  text: string;
  context: string | null; // 想法对应的划线原文（abstract）
  chapterUid: number | null;
  chapterIdx: number | null;
  chapterName: string | null;
  colorStyle: number | null;
  colorMeaning: string | null;
  createTime: number;
}

const COLOR_MEANINGS: Record<number, string> = {
  0: "默认色",
  1: "红色",
  2: "紫色",
  3: "蓝色",
  4: "绿色",
  5: "黄色"
};

export function colorMeaningFor(style: number | null): string | null {
  if (style === null) return null;
  return COLOR_MEANINGS[style] ?? `颜色样式 ${style}`;
}

export interface MyReview {
  reviewId: string;
  content: string;
  abstract: string | null;
  star: number;
  isFinish: boolean;
  chapterUid: number | null;
  chapterIdx: number | null;
  chapterName: string | null;
  createTime: number;
}

export interface ReadingTraceChapter {
  chapterUid: number | null;
  chapterIdx: number | null;
  chapterName: string | null;
  highlightCount: number;
  thoughtCount: number;
  firstAt: number;
  lastAt: number;
  tempo: string;
}

export interface ReadingTrace {
  currentProgress: number;
  readMinutes: number;
  finishedAt: string | null;
  inference: string;
  chapters: ReadingTraceChapter[];
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
  evidences: Evidence[];
  myReviews: MyReview[];
  readingTrace: ReadingTrace;
  meta: {
    progress: number;
    readMinutes: number;
    finishedAt: string | null;
    lastReadAt: string | null;
    highlightCount: number;
    thoughtCount: number;
  };
}

const FINISHED_TITLES = ["我的三个收获", "我与作者或书友分歧处", "还没想清的问题", "可复用的观点与行动"];
const ABANDONED_TITLES = ["为什么停", "已经带走了什么"];

interface ShelfRow {
  title: string;
  finished: number;
  abandoned: number;
  progress: number;
  read_minutes: number;
  last_read_at: string | null;
  finished_at: string | null;
}

interface HighlightRow {
  range: string;
  chapter_uid: number | null;
  chapter_idx: number | null;
  chapter_name: string | null;
  mark_text: string;
  color_style: number | null;
  create_time: number;
}

interface ThoughtRow {
  range: string;
  content: string;
  abstract: string | null;
  review_id: string | null;
  star: number;
  is_finish: number;
  chapter_uid: number | null;
  chapter_idx: number | null;
  chapter_name: string | null;
  create_time: number;
}

export function loadBookMaterials(vid: string, bookId: string) {
  const shelf = db
    .prepare(
      `SELECT s.finished, s.abandoned, s.progress, s.read_minutes, s.last_read_at, s.finished_at, c.title
       FROM shelf_snapshot s JOIN book_cache c ON c.book_id = s.book_id
       WHERE s.vid = ? AND s.book_id = ?`
    )
    .get(vid, bookId) as ShelfRow | undefined;
  if (!shelf) throw new Error("书架上没有这本书，无法回顾");
  const highlights = db
    .prepare(
      `SELECT range, chapter_uid, chapter_idx, chapter_name, mark_text, color_style, create_time
       FROM highlight WHERE vid = ? AND book_id = ? ORDER BY create_time`
    )
    .all(vid, bookId) as HighlightRow[];
  const thoughts = db
    .prepare(
      `SELECT range, content, abstract, review_id, star, is_finish, chapter_uid, chapter_idx, chapter_name, create_time
       FROM thought WHERE vid = ? AND book_id = ? ORDER BY create_time`
    )
    .all(vid, bookId) as ThoughtRow[];
  return { shelf, highlights, thoughts };
}

function toEvidence(highlight: HighlightRow): Evidence {
  return {
    id: highlight.range,
    kind: "highlight",
    text: highlight.mark_text,
    context: null,
    chapterUid: highlight.chapter_uid,
    chapterIdx: highlight.chapter_idx,
    chapterName: highlight.chapter_name,
    colorStyle: highlight.color_style,
    colorMeaning: colorMeaningFor(highlight.color_style),
    createTime: highlight.create_time
  };
}

function toThoughtEvidence(thought: ThoughtRow): Evidence {
  return {
    id: thought.range,
    kind: "thought",
    text: thought.content,
    context: thought.abstract,
    chapterUid: thought.chapter_uid,
    chapterIdx: thought.chapter_idx,
    chapterName: thought.chapter_name,
    colorStyle: null,
    colorMeaning: null,
    createTime: thought.create_time
  };
}

function isWholeBookReview(thought: ThoughtRow): boolean {
  return Boolean(thought.review_id) && thought.chapter_uid === null && thought.chapter_idx === null && thought.chapter_name === null;
}

function toMyReview(thought: ThoughtRow): MyReview {
  return {
    reviewId: thought.review_id ?? thought.range,
    content: thought.content,
    abstract: thought.abstract,
    star: Number.isFinite(thought.star) ? thought.star : -1,
    isFinish: thought.is_finish === 1,
    chapterUid: thought.chapter_uid,
    chapterIdx: thought.chapter_idx,
    chapterName: thought.chapter_name,
    createTime: thought.create_time
  };
}

function dateOnly(timestamp: number | null | undefined): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function normalizeProgress(progress: number): number {
  const value = Number.isFinite(progress) ? progress : 0;
  return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
}

async function refreshBookProgress(session: Session, bookId: string, shelf: ShelfRow): Promise<ShelfRow> {
  if (!session.gateway) return shelf;
  try {
    const response = await session.gateway.fetchBookProgress(bookId);
    const finished = isFinishedReading(response.book);
    const progress = normalizeProgress(response.book.progress);
    const readMinutes = Math.max(0, Math.round(readingSeconds(response.book) / 60));
    const lastReadAt = dateOnly(response.book.updateTime) ?? shelf.last_read_at;
    const finishedAt = response.book.finishTime ? dateOnly(response.book.finishTime) : finished ? shelf.finished_at : null;
    db.prepare(
      `UPDATE shelf_snapshot
       SET progress = ?, finished = ?, read_minutes = ?, last_read_at = ?, finished_at = ?
       WHERE vid = ? AND book_id = ?`
    ).run(progress, finished ? 1 : 0, readMinutes, lastReadAt, finishedAt, session.vid, bookId);
    return { ...shelf, progress, finished: finished ? 1 : 0, read_minutes: readMinutes, last_read_at: lastReadAt, finished_at: finishedAt };
  } catch {
    // 回顾仍可使用已落库素材；进度接口失败不应阻塞读后整理。
    return shelf;
  }
}

function buildReadingTrace(shelf: ShelfRow, highlights: HighlightRow[], thoughts: ThoughtRow[]): ReadingTrace {
  type MutableChapter = Omit<ReadingTraceChapter, "tempo">;
  const chapters = new Map<string, MutableChapter>();
  const add = (row: { chapter_uid: number | null; chapter_idx: number | null; chapter_name: string | null; create_time: number }, kind: "highlight" | "thought") => {
    if (row.chapter_uid === null && row.chapter_idx === null && row.chapter_name === null) return;
    const key = `${row.chapter_uid ?? ""}|${row.chapter_idx ?? ""}|${row.chapter_name ?? ""}`;
    const existing = chapters.get(key);
    if (existing) {
      existing.highlightCount += kind === "highlight" ? 1 : 0;
      existing.thoughtCount += kind === "thought" ? 1 : 0;
      existing.firstAt = Math.min(existing.firstAt, row.create_time);
      existing.lastAt = Math.max(existing.lastAt, row.create_time);
      return;
    }
    chapters.set(key, {
      chapterUid: row.chapter_uid,
      chapterIdx: row.chapter_idx,
      chapterName: row.chapter_name,
      highlightCount: kind === "highlight" ? 1 : 0,
      thoughtCount: kind === "thought" ? 1 : 0,
      firstAt: row.create_time,
      lastAt: row.create_time
    });
  };
  highlights.forEach((row) => add(row, "highlight"));
  thoughts.forEach((row) => add(row, "thought"));

  const ordered = [...chapters.values()].sort((a, b) => {
    if (a.chapterIdx !== null && b.chapterIdx !== null && a.chapterIdx !== b.chapterIdx) return a.chapterIdx - b.chapterIdx;
    if (a.chapterIdx !== null) return -1;
    if (b.chapterIdx !== null) return 1;
    return a.firstAt - b.firstAt;
  });
  let previousLast: number | null = null;
  const traceChapters = ordered.map((chapter, index) => {
    let tempo = "首条章节痕迹";
    if (index > 0 && previousLast !== null) {
      if (chapter.firstAt < previousLast) {
        tempo = "时间顺序与章节顺序不一致";
      } else {
        const gapDays = (chapter.firstAt - previousLast) / 86400;
        tempo = gapDays <= 1 ? "连续推进" : gapDays <= 7 ? "短间隔推进" : "长间隔后继续";
      }
    }
    previousLast = chapter.lastAt;
    return { ...chapter, tempo };
  });
  return {
    currentProgress: Math.round(shelf.progress),
    readMinutes: shelf.read_minutes,
    finishedAt: shelf.finished_at,
    inference: "以下章节节奏仅根据你的划线与想法时间分布推断，不代表微信读书官方阅读历史。",
    chapters: traceChapters
  };
}

function monthDay(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

// 演变事实：想法与其针对的划线构成前后对照（时间取自两条记录各自的 createTime）
function detectEvolution(highlights: HighlightRow[], thoughts: ThoughtRow[]): EvolutionFact[] {
  const facts: EvolutionFact[] = [];
  const byText = new Map(highlights.map((h) => [h.mark_text, h]));
  for (const thought of thoughts) {
    if (!/相反|改判|立场|方向|重新/.test(thought.content)) continue;
    const anchor = thought.abstract ? byText.get(thought.abstract) : undefined;
    facts.push({
      note: anchor
        ? `${monthDay(anchor.create_time)} 划下原文，${monthDay(thought.create_time)} 你写下「${thought.content.slice(0, 24)}…」——两条痕迹方向相反，作为事实列出`
        : `${monthDay(thought.create_time)} 你写下「${thought.content.slice(0, 24)}…」，其中包含对早前想法的修正——作为事实列出`,
      evidenceIds: anchor ? [anchor.range, thought.range] : [thought.range]
    });
  }
  return facts;
}

export async function buildRecall(session: Session, bookId: string): Promise<RecallDraft> {
  const materials = loadBookMaterials(session.vid, bookId);
  const { highlights, thoughts } = materials;
  if (highlights.length === 0 && thoughts.length === 0) {
    throw new Error("EMPTY_NOTES");
  }
  const shelf = await refreshBookProgress(session, bookId, materials.shelf);
  const framework: RecallDraft["framework"] =
    shelf.finished === 1 ? "finished" : shelf.abandoned === 1 ? "abandoned" : "reading";

  const meta = {
    progress: Math.round(shelf.progress),
    readMinutes: shelf.read_minutes,
    finishedAt: shelf.finished_at,
    lastReadAt: shelf.last_read_at,
    highlightCount: highlights.length,
    thoughtCount: thoughts.length
  };
  const evidences: Evidence[] = [
    ...highlights.map(toEvidence),
    ...thoughts.map(toThoughtEvidence)
  ];
  const myReviews = thoughts.filter(isWholeBookReview).map(toMyReview);
  const readingTrace = buildReadingTrace(shelf, highlights, thoughts);
  const evolution = detectEvolution(highlights, thoughts);

  const useLlm = process.env.WEREAD_MODE === "real" && Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL);
  const titles = framework === "abandoned" ? ABANDONED_TITLES : FINISHED_TITLES;
  const sections = useLlm
    ? await llmSections(titles, highlights, thoughts, evolution, framework)
    : ruleSections(titles, framework, shelf, highlights, thoughts);

  return {
    bookId,
    title: shelf.title,
    framework,
    llm: useLlm ? "llm" : "rules",
    headlineNote:
      framework === "reading"
        ? `在读 ${meta.progress}% · 阶段性回顾，按当前进度整理`
        : useLlm
          ? null
          : "未接入 LLM：本稿由时间线规则整理生成",
    sections,
    evolution,
    evidences,
    myReviews,
    readingTrace,
    meta
  };
}

// ---- 规则版（mock 模式与 degraded 共用）：段落全部由库内事实拼装，引文原样引用 ----

function ruleSections(
  titles: string[],
  framework: RecallDraft["framework"],
  shelf: ShelfRow,
  highlights: HighlightRow[],
  thoughts: ThoughtRow[]
): RecallSection[] {
  const pick = (rows: HighlightRow[], count: number): HighlightRow[] => {
    if (rows.length <= count) return rows;
    const step = (rows.length - 1) / (count - 1);
    return Array.from({ length: count }, (_, i) => rows[Math.round(i * step)]);
  };
  const dissent = thoughts.filter((t) => /打折扣|回避|立场|相反|样本|免除了/.test(t.content));
  const open = thoughts.filter((t) => /先记下来|改判|想清楚|重新/.test(t.content));
  const reusable = highlights.filter((h) => /框架|方法|清单|时间预算|粒度|工具|边界条件/.test(h.mark_text));

  if (framework === "abandoned") {
    if (highlights.length === 0) {
      return [
        {
          title: titles[0],
          paragraphs: ["没有找到划线时间线，只能确认这本书留下了想法而没有留下划线。"],
          evidenceIds: []
        },
        {
          title: titles[1],
          paragraphs: [`你留下了 ${thoughts.length} 条想法；它们是当前可见的带走部分。`],
          evidenceIds: thoughts.slice(0, 3).map((thought) => thought.range)
        }
      ];
    }
    const first = highlights[0];
    const last = highlights[highlights.length - 1];
    const days = Math.max(1, Math.round((last.create_time - first.create_time) / 86400));
    const halfPoint = first.create_time + (last.create_time - first.create_time) / 2;
    const earlyRatio = Math.round((highlights.filter((h) => h.create_time <= halfPoint).length / highlights.length) * 100);
    return [
      {
        title: titles[0],
        paragraphs: [
          `划线分布在 ${monthDay(first.create_time)} 到 ${monthDay(last.create_time)}（约 ${days} 天），其中 ${earlyRatio}% 集中在前半段，此后明显减速。`,
          `进度停在 ${Math.round(shelf.progress)}%，最后阅读时间为 ${shelf.last_read_at ?? "记录缺失"}。减速叠加进度停滞，通常意味着耐心在前半段已被耗尽——这是时间线上的事实，不是评判。`
        ],
        evidenceIds: [...pick(highlights, 2), last].filter((h, i, arr) => arr.findIndex((x) => x.range === h.range) === i).map((h) => h.range)
      },
      {
        title: titles[1],
        paragraphs: [
          `尽管停在 ${Math.round(shelf.progress)}%，你仍留下了 ${highlights.length} 条划线、${thoughts.length} 条想法。留下时间最晚的几条，是这本书真正被你带走的部分。`
        ],
        evidenceIds: pick(highlights, 3).map((h) => h.range)
      }
    ];
  }

  const chapters = [...new Set(highlights.map((h) => h.chapter_uid).filter((uid): uid is number => uid !== null))].sort((a, b) => a - b);
  const stage = framework === "reading" ? "到目前为止" : "全程";
  const chapterSummary = chapters.length > 0 ? `集中在第 ${chapters.slice(0, 4).join("、")}${chapters.length > 4 ? " 等" : ""} 章` : "暂未记录章节信息";
  return [
    {
      title: titles[0],
      paragraphs: [
        `${stage}共留下 ${highlights.length} 条划线，${chapterSummary}。`,
        "下面三条按时间顺序取自起点、中段与末段，作为收获的候选——是否成立，由你编辑定稿。"
      ],
      evidenceIds: pick(highlights, 3).map((h) => h.range)
    },
    {
      title: titles[1],
      paragraphs: [
        thoughts.length === 0
          ? "这条线上没有留下想法，暂无分歧素材。"
          : `你共写了 ${thoughts.length} 条想法，其中 ${dissent.length} 条带着明确的保留意见（“打折扣”“立场”“样本”等表述）。保留意见即分歧处。`
      ],
      evidenceIds: dissent.slice(0, 3).map((t) => t.range)
    },
    {
      title: titles[2],
      paragraphs: [
        open.length > 0
          ? `有 ${open.length} 条想法停在半途（“先记下来”“回来改判”），它们是最诚实的未解问题清单。`
          : "没有停在半途的想法——要么都想清了，要么还没开始想。"
      ],
      evidenceIds: open.slice(0, 3).map((t) => t.range)
    },
    {
      title: titles[3],
      paragraphs: [
        reusable.length > 0
          ? `划线里有 ${reusable.length} 条带方法论色彩（框架 / 清单 / 粒度 / 边界条件），复用价值最高。`
          : "划线以观点表述为主，方法论密度不高——复用建议从想法里自行提炼。"
      ],
      evidenceIds: pick(reusable, 3).map((h) => h.range)
    }
  ];
}

// ---- LLM 版（real 态）：LLM 只做组织与措辞，引文必须从素材 id 里选 ----

async function llmSections(
  titles: string[],
  highlights: HighlightRow[],
  thoughts: ThoughtRow[],
  evolution: EvolutionFact[],
  framework: RecallDraft["framework"]
): Promise<RecallSection[]> {
  const result = await generateJSON<{
    sections: { title: string; paragraphs: string[]; evidence_ids: string[] }[];
  }>(
    "你是读后回顾整理器。立场：忠实整理读者自己的划线与想法，不评判、不挑战、不编造——每段只能引用给定素材 id，禁止虚构引文。按给定的段落标题输出。只输出 JSON。",
    JSON.stringify({
      框架: framework === "abandoned" ? "弃读回顾（为什么停 / 已经带走了什么）" : framework === "reading" ? "在读阶段性回顾" : "读完回顾",
      段落标题: titles,
      划线: highlights.map((h) => ({ id: h.range, 章节: h.chapter_uid, 时间: monthDay(h.create_time), 原文: h.mark_text })),
      想法: thoughts.map((t) => ({ id: t.range, 时间: monthDay(t.create_time), 内容: t.content, 针对的划线: t.abstract })),
      已检测到的前后对照: evolution.map((e) => e.note),
      要求: { sections: `${titles.length} 段，标题用给定的`, evidence_ids: "只允许出现上面素材里的 id" }
    })
  );
  const known = new Set([...highlights.map((h) => h.range), ...thoughts.map((t) => t.range)]);
  return titles.map((title, index) => {
    const matched = result.sections.find((section) => section.title === title) ?? result.sections[index];
    return {
      title,
      paragraphs: matched?.paragraphs ?? [],
      // P1 证据规范：LLM 给出的引文 id 逐个校验，库里不存在的直接丢弃
      evidenceIds: (matched?.evidence_ids ?? []).filter((id) => known.has(id)).slice(0, 5)
    };
  });
}
