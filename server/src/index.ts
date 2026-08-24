import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { COVER_CACHE_DIR, db, seedMockIfEmpty } from "./db.js";
import { createGateway, GatewayHttpError } from "./gateway.js";
import { accountVidFromKey, isWeReadKey } from "./key.js";
import { isAccessRequired, isAccessTokenValid, issueAccessToken, requireAccess } from "./access.js";
import { hashSeed, paletteFromTitle, type Palette } from "./palette.js";
import {
  cacheShelfFromGateway,
  incrementalSyncNotes,
  markSyncError,
  processRemoteCover,
  runFullSync,
  syncStates,
  type Session,
  type SyncState
} from "./sync.js";
import { requireSession, sessions, type AuthedRequest } from "./sessions.js";
import { reviewRouter } from "./review/router.js";
import { accountRouter } from "./account/router.js";
import { MOCK_BOOKS, MOCK_VID, mockWeeklyMinutes } from "./mock/data.js";
import { svgCover } from "./mock/cover.js";
import {
  buildCandidates,
  buildCard,
  listDecisions,
  parseIntent,
  recordDecision,
  resolveBookByTitle
} from "./decide/engine.js";
import type { IntentResult } from "./decide/types.js";

const MODE = process.env.WEREAD_MODE === "real" ? "real" : "mock";
const PORT = 8787;

// 书架统一载荷：mock 与 real 落库后走完全相同的读取路径，UI/3D 层不感知模式差异
interface ShelfBook {
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
  sizeSeed: number; // 3D 书体物理尺寸（宽窄高矮）的随机种子
}

const app = express();
app.use(express.json());

// F3.6 例外端点：只报告门控状态或换取内存短期 token，不暴露原口令。
app.get("/api/access/status", (req: Request, res: Response) => {
  const required = isAccessRequired();
  res.json({ required, authenticated: !required || isAccessTokenValid(req.header("x-access-token")) });
});

app.post("/api/access/token", (req: Request, res: Response) => {
  if (!isAccessRequired()) {
    res.json({ required: false });
    return;
  }
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const token = issueAccessToken(password);
  if (!token) {
    res.status(403).json({ error: "访问口令错误" });
    return;
  }
  res.json({ required: true, token });
});

app.use(requireAccess);
app.use(reviewRouter);
app.use(accountRouter);

if (MODE === "mock") seedMockIfEmpty();

// ---- 会话 ----

app.post("/api/session", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
    if (MODE === "real") {
      if (!isWeReadKey(key)) {
        res.status(400).json({ error: "请输入微信读书 API Key" });
        return;
      }
      // 先建内存会话再后台验证/同步；上游失败只记入 sync state，不把用户踢回 Key 门。
      const gateway = createGateway(key);
      const session: Session = { sid: randomUUID(), vid: accountVidFromKey(key), gateway, createdAt: Date.now() };
      sessions.set(session.sid, session);
      void runFullSync(session.sid, session);
      res.json({ sid: session.sid, mode: MODE });
    } else {
      const session: Session = { sid: randomUUID(), vid: MOCK_VID, gateway: null, createdAt: Date.now() };
      sessions.set(session.sid, session);
      res.json({ sid: session.sid, mode: MODE });
    }
  } catch (err) {
    next(err);
  }
});

app.get("/api/session", (req: Request, res: Response) => {
  const session = sessions.get(req.header("x-sid") ?? "");
  if (!session) {
    res.json({ authenticated: false, mode: MODE });
    return;
  }
  res.json({ authenticated: true, mode: MODE, createdAt: session.createdAt });
});

app.delete("/api/session", (req: Request, res: Response) => {
  sessions.delete(req.header("x-sid") ?? "");
  res.json({ ok: true });
});

// ---- 同步进度（Key 门进度条轮询）----

app.get("/api/sync/progress", requireSession, (req: Request, res: Response) => {
  const state = syncStates.get(req.header("x-sid") ?? "");
  // mock 会话没有同步任务，直接报告完成（前端 mock 模式走本地 2 秒模拟动画，不会调这里）
  const fallback: SyncState = { phase: "done", current: 0, total: 0, percent: 1 };
  res.json(state ?? fallback);
});

// ---- 书架 ----

app.get("/api/shelf", requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as AuthedRequest).session;
    if (session.gateway) {
      const state = syncStates.get(session.sid);
      if (!state || state.phase === "done" || state.phase === "error") {
        // F3.2 增量同步：首次全量同步进行中时只读本地快照，避免并发请求上游。
        try {
          cacheShelfFromGateway(session.vid, await session.gateway.fetchShelf());
          await incrementalSyncNotes(session);
        } catch {
          // 上游失败时仍返回已有本地快照；失败状态由同步进度与设置页明确展示。
          markSyncError(session.sid);
        }
      }
    }
    res.json({ mode: MODE, books: loadShelf(session.vid), sync: syncStates.get(session.sid) });
  } catch (err) {
    next(err);
  }
});

function loadShelf(vid: string): ShelfBook[] {
  const rows = db
    .prepare(
      `SELECT s.book_id, s.progress, s.finished, s.abandoned, s.read_minutes, s.last_read_at,
              s.finished_at, s.archive, c.title, c.author, c.meta, c.dominant_color, c.palette
       FROM shelf_snapshot s JOIN book_cache c ON c.book_id = s.book_id
       WHERE s.vid = ? ORDER BY s.sort`
    )
    .all(vid) as Record<string, unknown>[];
  return rows.map((row) => {
    const meta = JSON.parse(row.meta as string) as { category?: string };
    const stored = (row.palette ? JSON.parse(row.palette as string) : null) as Palette | null;
    const palette = stored ?? paletteFromTitle(row.title as string);
    const bookId = row.book_id as string;
    return {
      bookId,
      title: row.title as string,
      author: (row.author as string) ?? "",
      category: meta.category ?? "",
      cover: `/api/cover/${bookId}`,
      dominant: (row.dominant_color as string) || palette.paper,
      palette,
      progress: row.progress as number,
      finished: row.finished === 1,
      abandoned: row.abandoned === 1,
      readMinutes: row.read_minutes as number,
      lastReadAt: (row.last_read_at as string) ?? null,
      finishedAt: (row.finished_at as string) ?? null,
      highlights: countNotes("highlight", bookId),
      thoughts: countNotes("thought", bookId),
      archive: (row.archive as string) ?? null,
      sizeSeed: hashSeed(bookId)
    };
  });
}

function countNotes(table: "highlight" | "thought", bookId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE book_id = ?`).get(bookId) as { count: number };
  return row.count;
}

// ---- 阅读数据四件 ----

app.get("/api/stats", requireSession, (req: Request, res: Response) => {
  const session = (req as AuthedRequest).session;
  const counts = db
    .prepare(`SELECT SUM(finished) AS finished, SUM(abandoned) AS abandoned FROM shelf_snapshot WHERE vid = ?`)
    .get(session.vid) as { finished: number | null; abandoned: number | null };
  const notes = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM highlight WHERE vid = ?) AS highlights,
              (SELECT COUNT(*) FROM thought WHERE vid = ?) AS thoughts`
    )
    .get(session.vid, session.vid) as { highlights: number; thoughts: number };
  const decisions = db
    .prepare(
      `SELECT id, topic, verdict, action, created_at FROM decision_record
       WHERE vid = ? ORDER BY created_at DESC LIMIT 5`
    )
    .all(session.vid);
  const baseline = db
    .prepare(`SELECT words_per_minute, basis FROM speed_baseline WHERE vid = ?`)
    .get(session.vid) as { words_per_minute: number; basis: string } | undefined;

  // weeklyMinutes / monthMinutes：mock 播种时写入，real 全量同步时写入，读取路径一致
  const settings = db.prepare(`SELECT read_stats FROM user_settings WHERE vid = ?`).get(session.vid) as {
    read_stats: string | null;
  } | undefined;
  let weeklyMinutes: { label: string; minutes: number }[] = [];
  let monthMinutes = 0;
  if (settings?.read_stats) {
    const parsed = JSON.parse(settings.read_stats) as { weeklyMinutes: typeof weeklyMinutes; monthMinutes: number };
    weeklyMinutes = parsed.weeklyMinutes;
    monthMinutes = parsed.monthMinutes;
  } else if (session.gateway === null) {
    // 兼容老 mock 库（无 read_stats 列数据）的兜底，正常路径不会走到
    weeklyMinutes = mockWeeklyMinutes();
    monthMinutes = weeklyMinutes.reduce((sum, week) => sum + week.minutes, 0);
  }

  res.json({
    weeklyMinutes,
    monthMinutes,
    finished: counts.finished ?? 0,
    abandoned: counts.abandoned ?? 0,
    highlights: notes.highlights,
    thoughts: notes.thoughts,
    recentDecisions: decisions,
    speedBaseline: baseline ? { wpm: baseline.words_per_minute, basis: baseline.basis } : null
  });
});

// ---- 选书决策（F1）----

app.post("/api/decide/intent", requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = typeof req.body?.input === "string" ? req.body.input.trim() : "";
    if (!input) {
      res.status(400).json({ error: "请先说说你想读什么" });
      return;
    }
    const session = (req as AuthedRequest).session;
    const intent = await parseIntent(input);
    if (intent.mode === "book") {
      intent.resolvedBookId = (await resolveBookByTitle(session, intent.topic)) ?? undefined;
      if (!intent.resolvedBookId) {
        res.status(404).json({ error: `没有找到《${intent.topic}》，试试主题式的说法` });
        return;
      }
    }
    res.json(intent);
  } catch (err) {
    next(err);
  }
});

app.post("/api/decide/candidates", requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as AuthedRequest).session;
    const intent = req.body?.intent as IntentResult | undefined;
    if (!intent || !intent.topic) {
      res.status(400).json({ error: "缺少阅读目标，请从输入重新开始" });
      return;
    }
    const offset = Math.max(0, Number(req.body?.offset ?? 0) || 0);
    res.json(await buildCandidates(session, intent, offset));
  } catch (err) {
    next(err);
  }
});

app.post("/api/decide/card", requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as AuthedRequest).session;
    const bookId = typeof req.body?.bookId === "string" ? req.body.bookId : "";
    const intent = req.body?.intent as IntentResult | undefined;
    if (!bookId || !intent?.verbatim) {
      res.status(400).json({ error: "缺少书目或目标" });
      return;
    }
    res.json(await buildCard(session, bookId, intent));
  } catch (err) {
    next(err);
  }
});

// F1.6 三动作 → 决策档案
app.post("/api/decision", requireSession, (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as AuthedRequest).session;
    const action = req.body?.action;
    if (!req.body?.cardId || !["read_now", "shelve", "skip"].includes(action)) {
      res.status(400).json({ error: "无效的决策动作" });
      return;
    }
    recordDecision(session.vid, {
      cardId: req.body.cardId,
      action,
      trigger: req.body.trigger,
      reason: req.body.reason
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get("/api/decision", requireSession, (req: Request, res: Response) => {
  const session = (req as AuthedRequest).session;
  res.json({ decisions: listDecisions(session.vid) });
});

// ---- 封面代理：mock 动态生成 SVG；real 走落盘缓存（懒回填为同步预处理的兜底）----

const COVER_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

app.get("/api/cover/:bookId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bookId = req.params.bookId;
    if (MODE === "mock") {
      const book = MOCK_BOOKS.find((entry) => entry.bookId === bookId);
      if (!book) {
        res.status(404).json({ error: "封面不存在" });
        return;
      }
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(svgCover(book));
      return;
    }

    const row = db
      .prepare(`SELECT cover_remote_url, cover_cache_file FROM book_cache WHERE book_id = ?`)
      .get(bookId) as { cover_remote_url: string | null; cover_cache_file: string | null } | undefined;
    if (!row) {
      res.status(404).json({ error: "封面不存在" });
      return;
    }

    if (row.cover_cache_file) {
      const body = await readFile(row.cover_cache_file);
      const ext = path.extname(row.cover_cache_file).slice(1).toLowerCase();
      res.setHeader("Content-Type", COVER_TYPES[ext] ?? "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.send(body);
      return;
    }
    if (!row.cover_remote_url) {
      res.status(404).json({ error: "封面不存在" });
      return;
    }

    const { body, contentType } = await processRemoteCover(bookId, row.cover_remote_url);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.send(body);
  } catch (err) {
    next(err);
  }
});

// 错误统一冒泡到这里
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof GatewayHttpError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err.message || "服务内部错误" });
});

app.listen(PORT, () => {
  console.log(`[weread-copilot] 服务端已启动：http://localhost:${PORT}（模式：${MODE}）`);
});
