import { Router, type Request, type Response } from "express";
import { db } from "../db.js";
import { requireSession, sessions, type AuthedRequest } from "../sessions.js";
import { cancelSync, syncStates } from "../sync.js";

export const accountRouter = Router();

export const SPOILER_LEVELS = ["none", "light", "full"] as const;
export type SpoilerLevel = (typeof SPOILER_LEVELS)[number];

export function isSpoilerLevel(value: unknown): value is SpoilerLevel {
  return typeof value === "string" && (SPOILER_LEVELS as readonly string[]).includes(value);
}

export function countPersonalNotes(table: "highlight" | "thought", vid: string, bookId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE vid = ? AND book_id = ?`)
    .get(vid, bookId) as { count: number };
  return row.count;
}

const PERSONAL_TABLES = [
  "user_settings",
  "highlight",
  "thought",
  "shelf_snapshot",
  "speed_baseline",
  "decision_record"
] as const;

const DEFAULT_SYNC = { phase: "done", current: 0, total: 0, percent: 1 } as const;

export interface PersonalDataExport {
  version: 1;
  exportedAt: string;
  data: Record<(typeof PERSONAL_TABLES)[number], Record<string, unknown>[]>;
}

export function loadPersonalData(vid: string): PersonalDataExport {
  const data = {} as PersonalDataExport["data"];
  for (const table of PERSONAL_TABLES) {
    data[table] = (db.prepare(`SELECT * FROM ${table} WHERE vid = ?`).all(vid) as Record<string, unknown>[]).map(
      ({ vid: _vid, ...row }) => row
    );
  }
  return { version: 1, exportedAt: new Date().toISOString(), data };
}

export function deletePersonalData(vid: string): void {
  const transaction = db.transaction(() => {
    for (const table of PERSONAL_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE vid = ?`).run(vid);
    }
  });
  transaction();
}

export function deletePersonalDataAndSession(sid: string, vid: string): void {
  cancelSync(sid);
  deletePersonalData(vid);
  sessions.delete(sid);
  syncStates.delete(sid);
}

accountRouter.get("/api/settings", requireSession, (req: Request, res: Response) => {
  const session = (req as AuthedRequest).session;
  const row = db
    .prepare(`SELECT spoiler_level FROM user_settings WHERE vid = ?`)
    .get(session.vid) as { spoiler_level?: string } | undefined;
  res.json({
    spoilerLevel: isSpoilerLevel(row?.spoiler_level) ? row.spoiler_level : "none",
    sync: syncStates.get(session.sid) ?? DEFAULT_SYNC
  });
});

accountRouter.put("/api/settings", requireSession, (req: Request, res: Response) => {
  const level = req.body?.spoilerLevel;
  if (!isSpoilerLevel(level)) {
    res.status(400).json({ error: "剧透偏好必须是 none、light 或 full" });
    return;
  }
  const session = (req as AuthedRequest).session;
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO user_settings (vid, spoiler_level, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(vid) DO UPDATE SET spoiler_level = excluded.spoiler_level, updated_at = excluded.updated_at`
  ).run(session.vid, level, now);
  res.json({ spoilerLevel: level });
});

accountRouter.get("/api/data/export", requireSession, (req: Request, res: Response) => {
  const session = (req as AuthedRequest).session;
  const payload = loadPersonalData(session.vid);
  res.setHeader("Content-Disposition", 'attachment; filename="weread-personal-data.json"');
  res.json(payload);
});

accountRouter.delete("/api/data", requireSession, (req: Request, res: Response) => {
  const sid = req.header("x-sid") ?? "";
  const session = (req as AuthedRequest).session;
  deletePersonalDataAndSession(sid, session.vid);
  res.json({ ok: true });
});
