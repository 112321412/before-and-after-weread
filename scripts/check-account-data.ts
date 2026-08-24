import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GatewayHttpError, type ShelfSyncResponse } from "../server/src/gateway.js";
import type { Session } from "../server/src/sync.js";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "weread-account-data-"));
process.env.WEREAD_MODE = "mock";
process.env.WEREAD_DATA_DIR = dataDir;
let closeDb: (() => void) | undefined;

try {
  const { db } = await import("../server/src/db.js");
  closeDb = () => db.close();
  const { accountVidFromKey } = await import("../server/src/key.js");
  const { countPersonalNotes, deletePersonalDataAndSession, isSpoilerLevel, loadPersonalData } = await import(
    "../server/src/account/router.js"
  );
  const { sessions } = await import("../server/src/sessions.js");
  const { SYNC_ERROR_MESSAGE, finishedSampleSignature, refreshIncrementalStats, runFullSync, syncStates } = await import(
    "../server/src/sync.js"
  );

  assert.equal(isSpoilerLevel("none"), true);
  assert.equal(isSpoilerLevel("light"), true);
  assert.equal(isSpoilerLevel("full"), true);
  assert.equal(isSpoilerLevel("spoiler"), false);
  assert.equal(isSpoilerLevel(null), false);
  const firstVid = accountVidFromKey("first-synthetic-key");
  const secondVid = accountVidFromKey("second-synthetic-key");
  assert.notEqual(firstVid, secondVid, "不同 Key 应使用不同个人数据命名空间");
  assert.doesNotMatch(firstVid, /first-synthetic-key|second-synthetic-key/);
  assert.doesNotMatch(secondVid, /first-synthetic-key|second-synthetic-key/);
  const appSource = await readFile(new URL("../web/src/App.tsx", import.meta.url), "utf8");
  assert.ok((appSource.match(/navigate\("\/shelf"\)/g) ?? []).length >= 2, "接入/退出后应回到书架路由");

  db.prepare(`INSERT INTO user_settings (vid, spoiler_level, read_stats, updated_at) VALUES (?, ?, ?, ?)`)
    .run("vid-a", "light", null, 1);
  db.prepare(`INSERT INTO user_settings (vid, spoiler_level, read_stats, updated_at) VALUES (?, ?, ?, ?)`)
    .run("vid-b", "full", null, 1);
  db.prepare(`INSERT INTO highlight (vid, book_id, chapter_uid, mark_text, range, create_time) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("vid-a", "book-a", 1, "a", "a-1", 1);
  db.prepare(`INSERT INTO highlight (vid, book_id, chapter_uid, mark_text, range, create_time) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("vid-b", "book-a", 1, "b", "b-a-1", 1);
  db.prepare(`INSERT INTO highlight (vid, book_id, chapter_uid, mark_text, range, create_time) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("vid-b", "book-b", 1, "b", "b-1", 1);
  db.prepare(`INSERT INTO thought (vid, book_id, content, abstract, range, create_time) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("vid-a", "book-a", "thought", null, "thought-1", 1);
  db.prepare(`INSERT INTO thought (vid, book_id, content, abstract, range, create_time) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("vid-b", "book-a", "other thought", null, "thought-b-1", 1);
  db.prepare(`INSERT INTO shelf_snapshot (vid, book_id, sync_time) VALUES (?, ?, ?)`)
    .run("vid-a", "book-a", 1);
  db.prepare(`INSERT INTO shelf_snapshot (vid, book_id, sync_time) VALUES (?, ?, ?)`)
    .run("vid-b", "book-b", 1);
  db.prepare(`INSERT INTO speed_baseline (vid, words_per_minute, basis, updated_at) VALUES (?, ?, ?, ?)`)
    .run("vid-a", 300, "estimated", 1);
  db.prepare(
    `INSERT INTO decision_record (vid, created_at, goal, topic, card_json, verdict, action, action_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("vid-a", 1, "systematic", "topic", "{}", "read_now", "read_now", 1);
  db.prepare(`INSERT INTO book_cache (book_id, title, meta, fetched_at) VALUES (?, ?, ?, ?)`)
    .run("shared-book", "Shared", "{}", 1);
  db.prepare(`INSERT INTO review_cache (book_id, band, reviews, snapshot_date) VALUES (?, ?, ?, ?)`)
    .run("shared-book", "recommend", "{}", new Date().toISOString());

  assert.equal(countPersonalNotes("highlight", "vid-a", "book-a"), 1, "当前 vid 应看到自己的划线");
  assert.equal(countPersonalNotes("highlight", "vid-b", "book-a"), 1, "另一 vid 的同一本书应单独计数");
  assert.equal(countPersonalNotes("highlight", "vid-a", "book-b"), 0, "不同 vid 的划线不得串入当前书");
  assert.equal(countPersonalNotes("thought", "vid-a", "book-a"), 1, "当前 vid 应看到自己的想法");
  assert.equal(countPersonalNotes("thought", "vid-b", "book-a"), 1, "另一 vid 的想法应单独计数");

  const exported = loadPersonalData("vid-a");
  assert.equal(exported.data.user_settings.length, 1);
  assert.equal(exported.data.highlight.length, 1);
  assert.equal(exported.data.thought.length, 1);
  assert.equal(exported.data.shelf_snapshot.length, 1);
  assert.equal(exported.data.speed_baseline.length, 1);
  assert.equal(exported.data.decision_record.length, 1);
  assert.equal("vid" in exported.data.user_settings[0], false, "导出不应暴露内部 vid 命名空间");
  assert.doesNotMatch(JSON.stringify(exported), /Authorization|Bearer|session secret|gateway/i);

  sessions.set("sid-a", { sid: "sid-a", vid: "vid-a", gateway: null, createdAt: 1 });
  syncStates.set("sid-a", { phase: "done", current: 1, total: 1, percent: 1 });
  deletePersonalDataAndSession("sid-a", "vid-a");
  assert.equal(sessions.has("sid-a"), false, "删除后当前 session 应失效");
  assert.equal(syncStates.has("sid-a"), false, "删除后当前 sync state 应清除");
  const count = (sql: string, value: string) => (db.prepare(sql).get(value) as { count: number }).count;
  assert.equal(count(`SELECT COUNT(*) AS count FROM highlight WHERE vid = ?`, "vid-a"), 0);
  assert.equal(count(`SELECT COUNT(*) AS count FROM user_settings WHERE vid = ?`, "vid-a"), 0);
  assert.equal(count(`SELECT COUNT(*) AS count FROM thought WHERE vid = ?`, "vid-a"), 0);
  assert.equal(count(`SELECT COUNT(*) AS count FROM shelf_snapshot WHERE vid = ?`, "vid-a"), 0);
  assert.equal(count(`SELECT COUNT(*) AS count FROM speed_baseline WHERE vid = ?`, "vid-a"), 0);
  assert.equal(count(`SELECT COUNT(*) AS count FROM decision_record WHERE vid = ?`, "vid-a"), 0);
  assert.equal(count(`SELECT COUNT(*) AS count FROM highlight WHERE vid = ?`, "vid-b"), 2);
  assert.equal(count(`SELECT COUNT(*) AS count FROM user_settings WHERE vid = ?`, "vid-b"), 1);
  assert.equal(count(`SELECT COUNT(*) AS count FROM book_cache WHERE book_id = ?`, "shared-book"), 1);
  assert.equal(count(`SELECT COUNT(*) AS count FROM review_cache WHERE book_id = ?`, "shared-book"), 1);

  let releaseShelf: ((shelf: ShelfSyncResponse) => void) | undefined;
  const delayedShelf = new Promise<ShelfSyncResponse>((resolve) => {
    releaseShelf = resolve;
  });
  const delayedGateway = {
    fetchNotebooks: async () => ({ totalBookCount: 0, totalNoteCount: 0, hasMore: 0, books: [] }),
    fetchShelf: async () => delayedShelf
  } as Session["gateway"];
  const delayedSession: Session = { sid: "sid-delayed", vid: "vid-delayed", gateway: delayedGateway, createdAt: 1 };
  sessions.set(delayedSession.sid, delayedSession);
  const delayedRun = runFullSync(delayedSession.sid, delayedSession);
  await new Promise<void>((resolve) => setImmediate(resolve));
  deletePersonalDataAndSession(delayedSession.sid, delayedSession.vid);
  releaseShelf?.({
    books: [
      {
        bookId: "deleted-book",
        title: "Deleted book",
        author: "",
        category: "",
        cover: null,
        progress: 1,
        readUpdateTime: 1,
        finishReading: 0
      }
    ],
    archive: [],
    bookCount: 1
  });
  await delayedRun;
  assert.equal(count(`SELECT COUNT(*) AS count FROM shelf_snapshot WHERE vid = ?`, delayedSession.vid), 0, "删除后在途书架响应不得写回");
  assert.equal(count(`SELECT COUNT(*) AS count FROM book_cache WHERE book_id = ?`, "deleted-book"), 0, "删除后在途响应不得留下共享书架缓存");

  let monthlySeconds = 120;
  const statsSession: Session = {
    sid: "sid-stats",
    vid: "vid-stats",
    gateway: {
      fetchReadData: async () => ({ baseTime: 0, readTimes: { "1704067200": monthlySeconds }, totalReadTime: monthlySeconds }),
      fetchBookProgress: async () => ({
        bookId: "finished-book",
        book: { progress: 99, readingTime: 3600, finishTime: 1, updateTime: 1 },
        timestamp: 1
      }),
      fetchBookInfo: async () => ({ bookId: "finished-book", title: "Finished", author: "", wordCount: 36000 })
    } as Session["gateway"],
    createdAt: 1
  };
  const beforeFinished = finishedSampleSignature(statsSession.vid);
  db.prepare(`INSERT OR REPLACE INTO shelf_snapshot (vid, book_id, finished, finished_at, sync_time) VALUES (?, ?, 1, ?, ?)`)
    .run(statsSession.vid, "finished-book", "2026-08-24", 2);
  await refreshIncrementalStats(statsSession, beforeFinished);
  const readStats = db.prepare(`SELECT read_stats FROM user_settings WHERE vid = ?`).get(statsSession.vid) as { read_stats: string };
  assert.equal(JSON.parse(readStats.read_stats).monthMinutes, 2, "每次增量同步应刷新阅读统计");
  const baseline = db
    .prepare(`SELECT words_per_minute, basis FROM speed_baseline WHERE vid = ?`)
    .get(statsSession.vid) as { words_per_minute: number; basis: string };
  assert.equal(baseline.words_per_minute, 600, "完成书样本变化后应刷新速度基线");
  assert.equal(baseline.basis, "own_median");
  monthlySeconds = 240;
  await refreshIncrementalStats(statsSession, finishedSampleSignature(statsSession.vid));
  assert.equal(
    JSON.parse((db.prepare(`SELECT read_stats FROM user_settings WHERE vid = ?`).get(statsSession.vid) as { read_stats: string }).read_stats)
      .monthMinutes,
    4,
    "下一次增量同步也应刷新阅读统计"
  );

  const badGateway = {
    fetchNotebooks: async () => {
      throw new GatewayHttpError(401);
    }
  };
  const badSession: Session = { sid: "sid-bad", vid: "vid-b", gateway: badGateway as Session["gateway"], createdAt: 1 };
  await runFullSync(badSession.sid, badSession);
  assert.equal(syncStates.get(badSession.sid)?.phase, "error");
  assert.equal(syncStates.get(badSession.sid)?.error, SYNC_ERROR_MESSAGE);
  assert.doesNotMatch(syncStates.get(badSession.sid)?.error ?? "", /Authorization|Bearer/);

  console.log("account data checks passed");
} finally {
  try {
    closeDb?.();
  } catch {
    // already closed
  }
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
