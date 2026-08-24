import { db } from "../db.js";
import { generateJSON } from "../llm.js";
import { colorMeaningFor, type Evidence, type EvolutionFact } from "./recall.js";

// F2.2 跨书主题整理：提问驱动，SQLite LIKE + 词元打分起步（不引向量库）。
// 组织方式是 问题 → 主题 → 分歧/演变，不按书罗列摘抄。
export interface ThemeEvidence extends Evidence {
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

// 停用字过滤后的 2-gram 分词：问题句里的虚词不参与检索
const STOP_CHARS = new Set("的了呢吗吧我与和或者在是有哪些怎么如何为什么这那不很也就会被上下中对从到为把让向于以及所".split(""));

function questionTerms(question: string): string[] {
  const terms = new Set<string>();
  for (let i = 0; i < question.length - 1; i += 1) {
    const gram = question.slice(i, i + 2);
    if (STOP_CHARS.has(gram[0]) || STOP_CHARS.has(gram[1])) continue;
    terms.add(gram);
  }
  return [...terms];
}

interface Row {
  id: string;
  kind: "highlight" | "thought";
  text: string;
  context: string | null;
  chapterUid: number | null;
  chapterIdx: number | null;
  chapterName: string | null;
  colorStyle: number | null;
  createTime: number;
  bookTitle: string;
}

interface ScoredRow extends Row {
  hitTerms: string[];
}

function searchRows(vid: string, question: string): { rows: ScoredRow[]; terms: string[] } {
  const terms = questionTerms(question);
  const rows: ScoredRow[] = [];
  const collect = (table: "highlight" | "thought") => {
    const sql =
      table === "highlight"
        ? `SELECT h.range AS id, 'highlight' AS kind, h.mark_text AS text, NULL AS context, h.chapter_uid AS chapterUid,
                  h.chapter_idx AS chapterIdx, h.chapter_name AS chapterName, h.color_style AS colorStyle,
                  h.create_time AS createTime, c.title AS bookTitle
           FROM highlight h JOIN book_cache c ON c.book_id = h.book_id WHERE h.vid = ?`
        : `SELECT t.range AS id, 'thought' AS kind, t.content AS text, t.abstract AS context, t.chapter_uid AS chapterUid,
                  t.chapter_idx AS chapterIdx, t.chapter_name AS chapterName, NULL AS colorStyle,
                  t.create_time AS createTime, c.title AS bookTitle
           FROM thought t JOIN book_cache c ON c.book_id = t.book_id WHERE t.vid = ?`;
    for (const row of db.prepare(sql).all(vid) as Row[]) {
      const hitTerms = terms.filter((term) => row.text.includes(term) || (row.context ?? "").includes(term));
      if (hitTerms.length > 0) rows.push({ ...row, hitTerms });
    }
  };
  collect("highlight");
  collect("thought");
  return { rows, terms };
}

export async function buildTheme(vid: string, question: string): Promise<ThemeResult> {
  const { rows: matched, terms } = searchRows(vid, question);
  const books = [...new Set(matched.map((row) => row.bookTitle))];
  const evidences: ThemeEvidence[] = matched.slice(0, 30).map((row) => ({
    id: row.id,
    kind: row.kind,
    text: row.text,
    context: row.context,
    chapterUid: row.chapterUid,
    chapterIdx: row.chapterIdx,
    chapterName: row.chapterName,
    colorStyle: row.colorStyle,
    colorMeaning: colorMeaningFor(row.colorStyle),
    createTime: row.createTime,
    bookTitle: row.bookTitle
  }));

  // 素材门槛（P1）：痕迹不足时明示，不硬生成
  if (matched.length < 4 || books.length < 2) {
    return {
      question,
      insufficient: true,
      note: `该主题下你只有 ${matched.length} 条痕迹（来自 ${books.length} 本书），样本不足以整理。痕迹至少覆盖 2 本书、4 条记录才会生成。`,
      totalMatches: matched.length,
      books,
      themes: [],
      evolution: [],
      evidences,
      llm: "rules"
    };
  }

  const evolution: EvolutionFact[] = [];
  for (const row of matched) {
    if (row.kind !== "thought" || !/相反|改判|立场|方向|重新/.test(row.text)) continue;
    evolution.push({
      note: `${monthDay(row.createTime)} 在《${row.bookTitle}》写下「${row.text.slice(0, 24)}…」——与早前的痕迹方向相反，作为事实列出`,
      evidenceIds: [row.id]
    });
  }

  const useLlm = process.env.WEREAD_MODE === "real" && Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL);
  const scored = matched
    .map((row) => ({ row, score: row.hitTerms.length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);

  let themes: ThemeGroup[];
  if (useLlm) {
    const result = await generateJSON<{ themes: { title: string; summary: string; evidence_ids: string[] }[] }>(
      "你是跨书主题整理器。把读者的划线与想法按问题组织成 2-4 个主题，呈现分歧与演变，不按书罗列。每段只能引用给定素材 id。只输出 JSON。",
      JSON.stringify({
        问题: question,
        素材: scored.map(({ row }) => ({ id: row.id, 书: row.bookTitle, 时间: monthDay(row.createTime), 内容: row.text, 针对的划线: row.context })),
        要求: { 主题数: "2-4", evidence_ids: "只允许出现素材里的 id" }
      })
    );
    const known = new Set(matched.map((row) => row.id));
    themes = result.themes.map((theme) => ({
      title: theme.title,
      summary: theme.summary,
      evidenceIds: theme.evidence_ids.filter((id) => known.has(id)).slice(0, 5)
    }));
  } else {
    // 规则版：按命中词元聚类成主题，摘要由事实拼装
    themes = terms
      .map((term) => {
        const hits = matched.filter((row) => row.hitTerms.includes(term));
        const termBooks = [...new Set(hits.map((row) => row.bookTitle))];
        return {
          term,
          hits,
          termBooks,
          weight: hits.length * (termBooks.length > 1 ? 2 : 1) // 跨书命中的词元权重加倍
        };
      })
      .filter((entry) => entry.hits.length >= 2)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((entry) => ({
        title: `关于「${entry.term}」`,
        summary: `${entry.hits.length} 条痕迹，来自《${entry.termBooks.slice(0, 3).join("》《")}》${entry.termBooks.length > 3 ? " 等" : ""}，时间跨度 ${monthDay(entry.hits[0].createTime)} 至 ${monthDay(entry.hits[entry.hits.length - 1].createTime)}。`,
        evidenceIds: entry.hits.slice(0, 4).map((row) => row.id)
      }));
  }

  return {
    question,
    insufficient: false,
    note: null,
    totalMatches: matched.length,
    books,
    themes,
    evolution,
    evidences,
    llm: useLlm ? "llm" : "rules"
  };
}

function monthDay(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}
