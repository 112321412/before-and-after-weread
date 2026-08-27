import { Router, type NextFunction, type Request, type Response } from "express";
import { db } from "../db.js";
import { requireSession, type AuthedRequest } from "../sessions.js";
import { buildRecall } from "./recall.js";
import { buildTheme } from "./theme.js";

// F2 读后整理路由：书列表 / 单书回顾 / 跨书主题 / 导出
export const reviewRouter = Router();

interface BookListItem {
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

interface ReviewBookSqlRow {
  book_id: string;
  title: string;
  author: string | null;
  finished: number;
  abandoned: number;
  progress: number;
  read_minutes: number;
  last_read_at: string | null;
  finished_at: string | null;
  highlights: number;
  thoughts: number;
}

export function mapReviewBookRow(row: ReviewBookSqlRow): BookListItem {
  return {
    bookId: row.book_id,
    title: row.title,
    author: row.author ?? "",
    group: row.finished === 1 ? "finished" : row.abandoned === 1 ? "abandoned" : "reading",
    progress: row.progress,
    readMinutes: row.read_minutes,
    lastReadAt: row.last_read_at,
    finishedAt: row.finished_at,
    highlights: row.highlights,
    thoughts: row.thoughts
  };
}

reviewRouter.get("/api/review/books", requireSession, (req: Request, res: Response) => {
  const session = (req as AuthedRequest).session;
  const rows = db
    .prepare(
      `SELECT s.book_id, s.finished, s.abandoned, s.progress, s.read_minutes, s.last_read_at, s.finished_at,
              c.title, c.author,
              (SELECT COUNT(*) FROM highlight WHERE vid = s.vid AND book_id = s.book_id) AS highlights,
              (SELECT COUNT(*) FROM thought WHERE vid = s.vid AND book_id = s.book_id) AS thoughts
       FROM shelf_snapshot s JOIN book_cache c ON c.book_id = s.book_id
       WHERE s.vid = ? AND (s.finished = 1 OR s.abandoned = 1 OR s.progress > 0)
       ORDER BY COALESCE(s.finished_at, s.last_read_at) DESC`
    )
    .all(session.vid) as ReviewBookSqlRow[];
  const books = rows.map(mapReviewBookRow);
  res.json({ books });
});

reviewRouter.post("/api/review/book/:bookId", requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as AuthedRequest).session;
    const draft = await buildRecall(session, req.params.bookId);
    res.json(draft);
  } catch (err) {
    if (err instanceof Error && err.message === "EMPTY_NOTES") {
      // 优雅空态：有书无痕迹
      res.status(422).json({ error: "这本书还没有留下痕迹——先去读一会儿，划下第一条线。" });
      return;
    }
    next(err);
  }
});

reviewRouter.post("/api/review/theme", requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
    if (!question) {
      res.status(400).json({ error: "请先提一个问题" });
      return;
    }
    res.json(await buildTheme((req as AuthedRequest).session.vid, question));
  } catch (err) {
    next(err);
  }
});

// P3 决议：对外导出一步预览确认——前端先渲染预览，用户确认后带最终 Markdown 调这里下载
reviewRouter.post("/api/review/export", requireSession, (req: Request, res: Response) => {
  const markdown = typeof req.body?.markdown === "string" ? req.body.markdown : "";
  const title = (typeof req.body?.title === "string" ? req.body.title : "阅读副驾导出").replace(/[\\/:*?"<>|]/g, "_");
  if (!markdown.trim()) {
    res.status(400).json({ error: "导出内容为空" });
    return;
  }
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(title)}.md"`);
  res.send(markdown);
});
