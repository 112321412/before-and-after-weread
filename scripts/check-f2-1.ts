import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GatewayClient, NotebookEntry } from "../server/src/gateway.js";
import type { Session } from "../server/src/sync.js";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "weread-f2-1-"));
process.env.WEREAD_MODE = "mock";
process.env.WEREAD_DATA_DIR = dataDir;

let closeDb: (() => void) | undefined;

try {
  // 先造一份旧表结构，验证启动时是原地补列，而不是删表重建。
  const oldDb = new Database(path.join(dataDir, "weread.db"));
  oldDb.exec(`
    CREATE TABLE book_cache (
      book_id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, meta TEXT NOT NULL DEFAULT '{}',
      cover_proxy_path TEXT, dominant_color TEXT, palette TEXT, fetched_at INTEGER NOT NULL
    );
    CREATE TABLE shelf_snapshot (
      vid TEXT NOT NULL, book_id TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0,
      finished INTEGER NOT NULL DEFAULT 0, abandoned INTEGER NOT NULL DEFAULT 0,
      read_minutes INTEGER NOT NULL DEFAULT 0, last_read_at TEXT, finished_at TEXT,
      archive TEXT, sort INTEGER NOT NULL DEFAULT 0, sync_time INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (vid, book_id)
    );
    CREATE TABLE highlight (
      vid TEXT NOT NULL, book_id TEXT NOT NULL, chapter_uid INTEGER NOT NULL,
      mark_text TEXT NOT NULL, range TEXT NOT NULL, create_time INTEGER NOT NULL,
      PRIMARY KEY (vid, book_id, range)
    );
    CREATE TABLE thought (
      vid TEXT NOT NULL, book_id TEXT NOT NULL, content TEXT NOT NULL, abstract TEXT,
      range TEXT NOT NULL, create_time INTEGER NOT NULL, PRIMARY KEY (vid, book_id, range)
    );
    INSERT INTO book_cache (book_id, title, author, meta, fetched_at) VALUES ('old-book', '旧结构书', '旧作者', '{}', 1);
    INSERT INTO shelf_snapshot (vid, book_id, progress, sort, sync_time) VALUES ('vid-a', 'old-book', 12, 1, 1);
    INSERT INTO highlight (vid, book_id, chapter_uid, mark_text, range, create_time)
      VALUES ('vid-a', 'old-book', 1, '旧结构划线仍在', 'old-highlight', 1);
    INSERT INTO thought (vid, book_id, content, abstract, range, create_time)
      VALUES ('vid-a', 'old-book', '旧结构想法仍在', NULL, 'old-thought', 2);
  `);
  oldDb.close();

  const { db } = await import("../server/src/db.js");
  closeDb = () => db.close();

  const columns = (table: string) =>
    new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name));
  assert.ok(columns("highlight").has("chapter_idx"));
  assert.ok(columns("highlight").has("chapter_name"));
  assert.ok(columns("highlight").has("color_style"));
  assert.ok(columns("thought").has("review_id"));
  assert.ok(columns("thought").has("star"));
  assert.ok(columns("thought").has("is_finish"));
  assert.equal(
    (db.prepare(`SELECT mark_text FROM highlight WHERE range = 'old-highlight'`).get() as { mark_text: string }).mark_text,
    "旧结构划线仍在",
    "旧数据库中的划线必须保留"
  );
  assert.equal(
    (db.prepare(`SELECT content FROM thought WHERE range = 'old-thought'`).get() as { content: string }).content,
    "旧结构想法仍在",
    "旧数据库中的想法必须保留"
  );
  assert.equal((db.prepare(`SELECT star FROM thought WHERE range = 'old-thought'`).get() as { star: number }).star, -1);

  const { replaceBookNotes } = await import("../server/src/sync.js");
  const { buildRecall, loadBookMaterials } = await import("../server/src/review/recall.js");
  const { deletePersonalDataAndSession, loadPersonalData } = await import("../server/src/account/router.js");
  const { sessions } = await import("../server/src/sessions.js");

  const firstAt = 1770000000;
  const gateway = {
    fetchBookmarks: async () => ({
      updated: [
        { bookmarkId: "bm-1", bookId: "old-book", chapterUid: 11, markText: "第一章原文", createTime: firstAt, type: 1, range: "range-1", colorStyle: 1 },
        { bookmarkId: "bm-2", bookId: "old-book", chapterUid: 22, markText: "第二章原文", createTime: firstAt + 2 * 86400, type: 1, range: "range-2", colorStyle: 3 }
      ],
      chapters: [
        { chapterUid: 11, chapterIdx: 1, title: "第一章" },
        { chapterUid: 22, chapterIdx: 2, title: "第二章" }
      ]
    }),
    fetchMyReviews: async () => ({
      reviews: [
        {
          review: {
            reviewId: "review-chapter",
            content: "章节想法",
            abstract: "第二章原文",
            range: "review-chapter",
            chapterUid: 22,
            star: 80,
            isFinish: 0,
            createTime: firstAt + 2 * 86400
          }
        },
        {
          review: {
            reviewId: "review-book",
            content: "整本书评",
            star: -1,
            isFinish: 1,
            createTime: firstAt + 3 * 86400
          }
        }
      ],
      totalCount: 2,
      hasMore: 0,
      synckey: 0
    }),
    fetchBookProgress: async () => ({
      bookId: "old-book",
      book: { progress: 99, readingTime: 3660, recordReadingTime: 999999, finishTime: firstAt + 4 * 86400, updateTime: firstAt + 4 * 86400 },
      timestamp: firstAt + 4 * 86400
    })
  } as unknown as GatewayClient;
  const entry: NotebookEntry = {
    bookId: "old-book",
    book: { title: "旧结构书", author: "旧作者", cover: "" },
    reviewCount: 2,
    noteCount: 2,
    bookmarkCount: 0,
    readingProgress: 0.99,
    markedStatus: 0,
    sort: 1
  };

  await replaceBookNotes("vid-a", gateway, entry);
  const storedHighlight = db
    .prepare(`SELECT chapter_idx, chapter_name, color_style FROM highlight WHERE vid = ? AND range = ?`)
    .get("vid-a", "range-2") as { chapter_idx: number; chapter_name: string; color_style: number };
  assert.deepEqual(storedHighlight, { chapter_idx: 2, chapter_name: "第二章", color_style: 3 });
  const storedThought = db
    .prepare(`SELECT review_id, star, is_finish, chapter_uid, chapter_idx, chapter_name FROM thought WHERE vid = ? AND range = ?`)
    .get("vid-a", "review-chapter") as Record<string, unknown>;
  assert.equal(storedThought.review_id, "review-chapter");
  assert.equal(storedThought.star, 4, "百分制星级应归一为 0-5 星");
  assert.equal(storedThought.is_finish, 0);
  assert.equal(storedThought.chapter_uid, 22);
  assert.equal(storedThought.chapter_idx, 2);
  assert.equal(storedThought.chapter_name, "第二章");

  // 同一本书写入另一 vid，回顾仍只能读取当前个人数据。
  db.prepare(
    `INSERT INTO highlight (vid, book_id, chapter_uid, chapter_idx, chapter_name, mark_text, color_style, range, create_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("vid-b", "old-book", 11, 1, "第一章", "另一用户划线", 2, "other-highlight", firstAt);
  db.prepare(
    `INSERT INTO thought (vid, book_id, content, abstract, review_id, star, is_finish, chapter_uid, chapter_idx, chapter_name, range, create_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("vid-b", "old-book", "另一用户想法", null, "other-review", 5, 1, 11, 1, "第一章", "other-thought", firstAt);
  db.prepare(`INSERT INTO shelf_snapshot (vid, book_id, progress, sort, sync_time) VALUES (?, ?, ?, ?, ?)`).run(
    "vid-b",
    "old-book",
    20,
    2,
    1
  );
  const sessionA: Session = { sid: "sid-a", vid: "vid-a", gateway, createdAt: 1 };
  const draft = await buildRecall(sessionA, "old-book");
  assert.equal(draft.framework, "finished");
  assert.equal(draft.myReviews.length, 1);
  assert.equal(draft.myReviews[0].reviewId, "review-book");
  assert.equal(draft.myReviews[0].star, -1);
  assert.equal(draft.myReviews[0].isFinish, true);
  assert.equal(draft.readingTrace.currentProgress, 99);
  assert.equal(draft.readingTrace.readMinutes, 61, "累计时长使用文字阅读时长且按分钟落库");
  assert.equal(draft.readingTrace.finishedAt, new Date((firstAt + 4 * 86400) * 1000).toISOString().slice(0, 10));
  assert.match(draft.readingTrace.inference, /推断|不代表微信读书官方阅读历史/);
  assert.equal(draft.readingTrace.chapters.length, 2);
  assert.equal(draft.readingTrace.chapters[1].chapterName, "第二章");
  assert.equal(draft.readingTrace.chapters[1].tempo, "短间隔推进");
  const blue = draft.evidences.find((evidence) => evidence.id === "range-2");
  assert.equal(blue?.chapterName, "第二章");
  assert.equal(blue?.colorMeaning, "蓝色");
  const thoughtEvidence = draft.evidences.find((evidence) => evidence.id === "review-chapter");
  assert.equal(thoughtEvidence?.context, "第二章原文");
  assert.equal(draft.evidences.some((evidence) => evidence.text.includes("另一用户")), false, "回顾不得串入其他 vid");
  assert.equal(loadBookMaterials("vid-b", "old-book").highlights.length, 1);

  db.prepare(`INSERT INTO user_settings (vid, spoiler_level, updated_at) VALUES (?, ?, ?)`).run("vid-a", "light", 1);
  db.prepare(`INSERT INTO speed_baseline (vid, words_per_minute, basis, updated_at) VALUES (?, ?, ?, ?)`).run("vid-a", 400, "estimated", 1);
  db.prepare(
    `INSERT INTO decision_record (vid, created_at, goal, topic, card_json, verdict) VALUES (?, ?, ?, ?, ?, ?)`
  ).run("vid-a", 1, "systematic", "fixture", "{}", "read_now");
  db.prepare(`INSERT INTO book_cache (book_id, title, meta, fetched_at) VALUES (?, ?, ?, ?)`).run("shared-book", "共享缓存书", "{}", 1);
  db.prepare(`INSERT INTO review_cache (book_id, band, reviews, snapshot_date) VALUES (?, ?, ?, ?)`).run("shared-book", "recommend", "{}", new Date().toISOString());
  const exported = loadPersonalData("vid-a");
  const exportedHighlight = exported.data.highlight.find((row) => row.range === "range-2");
  assert.equal(exportedHighlight?.chapter_idx, 2);
  assert.equal(exportedHighlight?.color_style, 3);
  assert.equal(exported.data.thought.some((row) => row.review_id === "review-book" && row.star === -1 && row.is_finish === 1), true);
  assert.doesNotMatch(JSON.stringify(exported), /Authorization|Bearer|Cookie|session secret/i);

  sessions.set(sessionA.sid, sessionA);
  deletePersonalDataAndSession(sessionA.sid, sessionA.vid);
  assert.equal(sessions.has(sessionA.sid), false);
  assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM highlight WHERE vid = ?`).get("vid-a") as { count: number }).count, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM thought WHERE vid = ?`).get("vid-a") as { count: number }).count, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM highlight WHERE vid = ?`).get("vid-b") as { count: number }).count, 1);
  assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM book_cache WHERE book_id = ?`).get("shared-book") as { count: number }).count, 1);
  assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM review_cache WHERE book_id = ?`).get("shared-book") as { count: number }).count, 1);

  console.log("f2.1 checks passed");
} finally {
  try {
    closeDb?.();
  } catch {
    // 数据库已关闭时无需重复处理
  }
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
