import { writeFile } from "node:fs/promises";
import path from "node:path";
import { COVER_CACHE_DIR, db } from "./db.js";
import type { GatewayClient, NotebookEntry, NotebooksResponse, ShelfSyncResponse } from "./gateway.js";
import { dominantFromImage, paletteFromDominant } from "./palette.js";
import { isFinishedReading, readingSeconds, resolveWordCount } from "./reading.js";

// ---- 会话与同步状态 ----

export interface Session {
  sid: string;
  vid: string;
  gateway: GatewayClient | null; // mock 模式为 null；key 封闭在网关客户端里，不落盘不写日志
  createdAt: number;
}

export type SyncPhase = "notebooks" | "shelf" | "notes" | "covers" | "readdata" | "baseline" | "done" | "error";

export interface SyncState {
  phase: SyncPhase;
  current: number;
  total: number;
  percent: number;
  error?: string;
}

// 阶段权重：笔记同步是大头（重度用户每本书 2 次网关调用）
const PHASE_WEIGHTS: { phase: SyncPhase; weight: number }[] = [
  { phase: "notebooks", weight: 0.05 },
  { phase: "shelf", weight: 0.05 },
  { phase: "notes", weight: 0.55 },
  { phase: "covers", weight: 0.3 },
  { phase: "readdata", weight: 0.03 },
  { phase: "baseline", weight: 0.02 }
];

export const syncStates = new Map<string, SyncState>();
export const SYNC_ERROR_MESSAGE = "真实数据同步失败，可更换 Key 重试";
const cancelledSyncs = new Set<string>();

export function isSyncActive(sid: string): boolean {
  return !cancelledSyncs.has(sid);
}

export function cancelSync(sid: string): void {
  cancelledSyncs.add(sid);
}

function updateState(sid: string, phase: SyncPhase, current: number, total: number): void {
  if (!isSyncActive(sid)) return;
  if (phase === "done") {
    syncStates.set(sid, { phase, current, total, percent: 1 });
    return;
  }
  const index = PHASE_WEIGHTS.findIndex((entry) => entry.phase === phase);
  const base = PHASE_WEIGHTS.slice(0, Math.max(index, 0)).reduce((sum, entry) => sum + entry.weight, 0);
  const weight = index >= 0 ? PHASE_WEIGHTS[index].weight : 0;
  const fraction = total > 0 ? Math.min(1, Math.max(0, current / total)) : 1;
  syncStates.set(sid, {
    phase,
    current,
    total,
    percent: Math.min(1, base + weight * fraction)
  });
}

function errorState(sid: string): void {
  if (!isSyncActive(sid)) return;
  const previous = syncStates.get(sid);
  syncStates.set(sid, {
    phase: "error",
    current: 0,
    total: 0,
    percent: previous?.percent ?? 0,
    error: SYNC_ERROR_MESSAGE
  });
}

export function markSyncError(sid: string): void {
  errorState(sid);
}

// ---- 并发原语 ----

async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

// ---- 网关翻页 ----

// /user/notebooks 游标翻页：hasMore=1 时用最后一本 sort 续拉到取完
export async function paginateNotebooks(gateway: GatewayClient, seedPage?: NotebooksResponse): Promise<NotebookEntry[]> {
  const entries: NotebookEntry[] = [];
  let page = seedPage ?? (await gateway.fetchNotebooks());
  for (;;) {
    entries.push(...page.books);
    if (page.hasMore !== 1 || page.books.length === 0) return entries;
    page = await gateway.fetchNotebooks(page.books[page.books.length - 1].sort);
  }
}

// /review/list/mine 的 synckey 翻页
async function paginateMyReviews(gateway: GatewayClient, bookId: string) {
  const reviews: {
    reviewId: string;
    content: string;
    abstract?: string;
    range?: string;
    chapterUid?: number;
    createTime: number;
  }[] = [];
  let synckey = 0;
  for (;;) {
    const page = await gateway.fetchMyReviews(bookId, synckey);
    reviews.push(...page.reviews.map((entry) => entry.review));
    if (page.hasMore !== 1 || !page.synckey) return reviews;
    synckey = page.synckey;
  }
}

// ---- 笔记落库（划线 + 想法）----

export async function replaceBookNotes(vid: string, gateway: GatewayClient, entry: NotebookEntry, sid?: string): Promise<void> {
  const [marks, reviews] = await Promise.all([
    gateway.fetchBookmarks(entry.bookId),
    paginateMyReviews(gateway, entry.bookId)
  ]);
  if (sid && !isSyncActive(sid)) return;
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM highlight WHERE vid = ? AND book_id = ?`).run(vid, entry.bookId);
    const insertHighlight = db.prepare(
      `INSERT INTO highlight (vid, book_id, chapter_uid, mark_text, range, create_time) VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const mark of marks.updated) {
      insertHighlight.run(vid, entry.bookId, mark.chapterUid, mark.markText, mark.range, mark.createTime);
    }
    db.prepare(`DELETE FROM thought WHERE vid = ? AND book_id = ?`).run(vid, entry.bookId);
    const insertThought = db.prepare(
      `INSERT INTO thought (vid, book_id, content, abstract, range, create_time) VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const review of reviews) {
      // 书评/章节点评没有 range，用 reviewId 兜住唯一键
      insertThought.run(vid, entry.bookId, review.content, review.abstract ?? null, review.range ?? `review-${review.reviewId}`, review.createTime);
    }
    setNoteSort(vid, entry.bookId, entry.sort, entry.readingProgress);
  });
  tx();
}

function setNoteSort(vid: string, bookId: string, sort: number, readingProgress: number): void {
  const result = db
    .prepare(`UPDATE shelf_snapshot SET note_sort = ? WHERE vid = ? AND book_id = ?`)
    .run(sort, vid, bookId);
  if (result.changes > 0) return;
  // 有笔记但不在书架快照里的书，补一行最小记录，保证增量对比有落点
  const progress = readingProgress > 1 ? readingProgress : readingProgress * 100;
  db.prepare(
    `INSERT OR REPLACE INTO shelf_snapshot (vid, book_id, progress, finished, abandoned, read_minutes, last_read_at, finished_at, archive, sort, note_sort, sync_time)
     VALUES (?, ?, ?, 0, 0, 0, NULL, NULL, NULL, 9999, ?, ?)`
  ).run(vid, bookId, progress, sort, Math.floor(Date.now() / 1000));
}

// ---- 书架落库 ----

export function cacheShelfFromGateway(vid: string, shelf: ShelfSyncResponse, sid?: string): void {
  if (sid && !isSyncActive(sid)) return;
  const now = Math.floor(Date.now() / 1000);
  const upsertBook = db.prepare(`
    INSERT INTO book_cache (book_id, title, author, meta, cover_proxy_path, cover_remote_url, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id) DO UPDATE SET
      title = COALESCE(NULLIF(book_cache.title, ''), excluded.title),
      author = COALESCE(NULLIF(book_cache.author, ''), excluded.author),
      cover_remote_url = COALESCE(excluded.cover_remote_url, book_cache.cover_remote_url),
      fetched_at = excluded.fetched_at`);
  const upsertShelf = db.prepare(`
    INSERT INTO shelf_snapshot
      (vid, book_id, progress, finished, abandoned, read_minutes, last_read_at, finished_at, archive, sort, sync_time)
    VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
    ON CONFLICT(vid, book_id) DO UPDATE SET progress = excluded.progress, finished = excluded.finished,
      last_read_at = excluded.last_read_at, finished_at = excluded.finished_at, archive = excluded.archive,
      sync_time = excluded.sync_time`);
  const archiveOf = (bookId: string) => shelf.archive.find((entry) => entry.bookIds.includes(bookId))?.name ?? null;
  const tx = db.transaction(() => {
    shelf.books.forEach((book, index) => {
      upsertBook.run(
        book.bookId,
        book.title,
        book.author,
        JSON.stringify({ category: book.category ?? "" }),
        `/api/cover/${book.bookId}`,
        book.cover ?? null,
        now
      );
      const finished = book.finishReading === 1;
      const lastReadAt = book.readUpdateTime ? new Date(book.readUpdateTime * 1000).toISOString().slice(0, 10) : null;
      const progress = book.progress ?? (finished ? 100 : 0);
      upsertShelf.run(vid, book.bookId, progress, finished ? 1 : 0, lastReadAt, finished ? lastReadAt : null, archiveOf(book.bookId), index, now);
    });
  });
  tx();
}

// ---- 封面预处理（拉取 → 落盘缓存 → 主色调色板写回 book_cache）----

const COVER_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

export async function processRemoteCover(
  bookId: string,
  remoteUrl: string,
  sid?: string
): Promise<{ body: Buffer; contentType: string }> {
  const imageRes = await fetch(remoteUrl);
  if (!imageRes.ok) throw new Error(`封面拉取失败：HTTP ${imageRes.status}`);
  const body = Buffer.from(await imageRes.arrayBuffer());
  if (sid && !isSyncActive(sid)) throw new Error("SYNC_CANCELLED");
  const contentType = imageRes.headers.get("content-type") ?? "image/jpeg";
  const ext = Object.entries(COVER_TYPES).find(([, type]) => type === contentType)?.[0] ?? "jpg";
  const cacheFile = path.join(COVER_CACHE_DIR, `${bookId}.${ext}`);
  await writeFile(cacheFile, body);

  let dominant: string | null = null;
  let paletteJson: string | null = null;
  try {
    dominant = await dominantFromImage(body);
    paletteJson = JSON.stringify(paletteFromDominant(dominant));
  } catch {
    // 位图解码失败时保留书名回退色，封面本身照常下发
  }
  if (sid && !isSyncActive(sid)) throw new Error("SYNC_CANCELLED");
  db.prepare(
    `UPDATE book_cache SET cover_cache_file = ?, dominant_color = COALESCE(?, dominant_color), palette = COALESCE(?, palette) WHERE book_id = ?`
  ).run(cacheFile, dominant, paletteJson, bookId);
  return { body, contentType };
}

async function prefetchCovers(sid: string, vid: string): Promise<void> {
  if (!isSyncActive(sid)) return;
  const rows = db
    .prepare(
      `SELECT c.book_id, c.cover_remote_url
       FROM shelf_snapshot s JOIN book_cache c ON c.book_id = s.book_id
       WHERE s.vid = ? AND c.cover_remote_url IS NOT NULL
         AND (c.cover_cache_file IS NULL OR c.palette IS NULL)`
    )
    .all(vid) as { book_id: string; cover_remote_url: string }[];
  updateState(sid, "covers", 0, rows.length);
  if (rows.length === 0) return;
  let done = 0;
  await mapWithConcurrency(rows, 8, async (row) => {
    try {
      await processRemoteCover(row.book_id, row.cover_remote_url, sid);
    } catch {
      // 单本封面失败不中断整场同步；/api/cover 的懒回填仍可兜住这本书
    } finally {
      done += 1;
      updateState(sid, "covers", done, rows.length);
    }
  });
}

// ---- 阅读数据（readdata monthly → 周分桶 + 本月总时长）----

export function bucketWeeklyMinutes(
  readTimes: Record<string, number>,
  totalReadTimeSeconds?: number
): { weeklyMinutes: { label: string; minutes: number }[]; monthMinutes: number } {
  // readTimes 的 key 是秒级「当天起始」时间戳（微信读书按北京时间分桶）。
  // 统一换成 UTC+8 墙钟后按周一为一周起点聚合。
  const weeks = new Map<number, number>();
  for (const [key, seconds] of Object.entries(readTimes)) {
    const shifted = new Date(Number(key) * 1000 + 8 * 3600 * 1000);
    const weekday = (shifted.getUTCDay() + 6) % 7;
    const weekStart = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - weekday);
    weeks.set(weekStart, (weeks.get(weekStart) ?? 0) + seconds);
  }
  const weeklyMinutes = [...weeks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekStart, seconds]) => {
      const date = new Date(weekStart);
      const label = `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
      return { label, minutes: Math.round(seconds / 60) };
    });
  const totalSeconds = totalReadTimeSeconds ?? [...weeks.values()].reduce((sum, value) => sum + value, 0);
  return { weeklyMinutes, monthMinutes: Math.round(totalSeconds / 60) };
}

async function syncReadStats(sid: string, gateway: GatewayClient, vid: string): Promise<void> {
  updateState(sid, "readdata", 0, 1);
  const data = await gateway.fetchReadData("monthly");
  if (!isSyncActive(sid)) return;
  const { weeklyMinutes, monthMinutes } = bucketWeeklyMinutes(data.readTimes, data.totalReadTime);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT OR IGNORE INTO user_settings (vid, spoiler_level, updated_at) VALUES (?, 'none', ?)`).run(vid, now);
  db.prepare(`UPDATE user_settings SET read_stats = ?, updated_at = ? WHERE vid = ?`).run(
    JSON.stringify({ weeklyMinutes, monthMinutes }),
    now,
    vid
  );
  updateState(sid, "readdata", 1, 1);
}

// ---- 速度基线（F3.3：最近读完 ≤5 本，字/分钟中位数）----

export function computeBaseline(samples: number[]): { wpm: number; basis: "own_median" | "estimated" } {
  if (samples.length === 0) return { wpm: 425, basis: "estimated" }; // 群体均值 350-500 的中点
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { wpm: Math.round(median), basis: "own_median" };
}

async function syncBaseline(sid: string, gateway: GatewayClient, vid: string): Promise<void> {
  if (!isSyncActive(sid)) return;
  updateState(sid, "baseline", 0, 1);
  const finished = db
    .prepare(
      `SELECT s.book_id FROM shelf_snapshot s WHERE s.vid = ? AND s.finished = 1
       ORDER BY s.finished_at DESC LIMIT 8`
    )
    .all(vid) as { book_id: string }[];
  const samples: number[] = [];
  for (const row of finished) {
    if (samples.length >= 5) break;
    const [progress, info] = await Promise.all([
      gateway.fetchBookProgress(row.book_id),
      gateway.fetchBookInfo(row.book_id)
    ]);
    if (!isSyncActive(sid)) return;
    // 真实口径（见 gateway.ts 注释）：读完看 finishTime；时长用 readingTime（recordReadingTime 是朗读时长）
    const minutes = readingSeconds(progress.book) / 60;
    const finishedBook = isFinishedReading(progress.book);
    let wordCount = info.wordCount ?? 0;
    if (wordCount <= 0) {
      // /book/info 的网关回包常无 wordCount，从章节目录求和
      const chapters = await gateway.fetchChapterInfo(row.book_id);
      if (!isSyncActive(sid)) return;
      wordCount = resolveWordCount(info.wordCount, chapters.chapters.map((chapter) => chapter.wordCount));
    }
    if (!finishedBook || minutes <= 30 || !(wordCount > 0)) continue;
    samples.push(wordCount / minutes);
  }
  if (!isSyncActive(sid)) return;
  const { wpm, basis } = computeBaseline(samples);
  db.prepare(`INSERT OR REPLACE INTO speed_baseline (vid, words_per_minute, basis, updated_at) VALUES (?, ?, ?, ?)`).run(
    vid,
    wpm,
    basis,
    Math.floor(Date.now() / 1000)
  );
  updateState(sid, "baseline", 1, 1);
}

// ---- 全量同步（F3.1，Key 验证通过后后台执行）----

export async function runFullSync(sid: string, session: Session, seedPage?: NotebooksResponse): Promise<void> {
  const gateway = session.gateway;
  if (!gateway || !isSyncActive(sid)) return;
  try {
    updateState(sid, "notebooks", 0, 1);
    const entries = await paginateNotebooks(gateway, seedPage);
    if (!isSyncActive(sid)) return;
    updateState(sid, "notebooks", 1, 1);

    updateState(sid, "shelf", 0, 1);
    const shelf = await gateway.fetchShelf();
    if (!isSyncActive(sid)) return;
    cacheShelfFromGateway(session.vid, shelf, sid);
    updateState(sid, "shelf", 1, 1);

    const targets = entries.filter((entry) => entry.noteCount + entry.reviewCount > 0);
    updateState(sid, "notes", 0, targets.length);
    let notesDone = 0;
    await mapWithConcurrency(targets, 8, async (entry) => {
      await replaceBookNotes(session.vid, gateway, entry, sid);
      notesDone += 1;
      updateState(sid, "notes", notesDone, targets.length);
    });

    if (!isSyncActive(sid)) return;
    await prefetchCovers(sid, session.vid);
    if (!isSyncActive(sid)) return;
    await syncReadStats(sid, gateway, session.vid);
    if (!isSyncActive(sid)) return;
    await syncBaseline(sid, gateway, session.vid);
    if (!isSyncActive(sid)) return;
    updateState(sid, "done", 1, 1);
  } catch {
    if (isSyncActive(sid)) errorState(sid);
  }
}

// ---- 增量同步（F3.2：笔记概览 sort 对比，只重拉变化的书）----

export function finishedSampleSignature(vid: string): string {
  const rows = db
    .prepare(
      `SELECT book_id, finished_at FROM shelf_snapshot
       WHERE vid = ? AND finished = 1
       ORDER BY finished_at DESC, book_id LIMIT 5`
    )
    .all(vid) as { book_id: string; finished_at: string | null }[];
  return rows.map((row) => `${row.book_id}:${row.finished_at ?? ""}`).join("|");
}

export async function incrementalSyncNotes(session: Session): Promise<number> {
  const gateway = session.gateway;
  if (!gateway || !isSyncActive(session.sid)) return 0;
  const entries = await paginateNotebooks(gateway);
  if (!isSyncActive(session.sid)) return 0;
  const stored = new Map(
    (
      db.prepare(`SELECT book_id, note_sort FROM shelf_snapshot WHERE vid = ?`).all(session.vid) as {
        book_id: string;
        note_sort: number | null;
      }[]
    ).map((row) => [row.book_id, row.note_sort])
  );
  const changed = entries.filter(
    (entry) => entry.noteCount + entry.reviewCount > 0 && stored.get(entry.bookId) !== entry.sort
  );
  await mapWithConcurrency(changed, 8, (entry) => replaceBookNotes(session.vid, gateway, entry, session.sid));
  return changed.length;
}

export async function refreshIncrementalStats(session: Session, previousFinishedSample: string): Promise<void> {
  const gateway = session.gateway;
  if (!gateway || !isSyncActive(session.sid)) return;
  await syncReadStats(session.sid, gateway, session.vid);
  if (!isSyncActive(session.sid)) return;
  if (finishedSampleSignature(session.vid) !== previousFinishedSample) {
    await syncBaseline(session.sid, gateway, session.vid);
    if (!isSyncActive(session.sid)) return;
  }
  updateState(session.sid, "done", 1, 1);
}
