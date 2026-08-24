import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { paletteFromDominant } from "./palette.js";
import { MOCK_BOOKS, MOCK_VID, mockHighlightRows, mockThoughtRows, mockWeeklyMinutes } from "./mock/data.js";

// tsx 直接运行 src，数据落在 server/data/（gitignore 已覆盖）。
// WEREAD_DATA_DIR 供同步管道空跑自检指向临时目录，不影响正常运行。
const dataDir = process.env.WEREAD_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const coverDir = path.join(dataDir, "covers");
mkdirSync(coverDir, { recursive: true });
export const COVER_CACHE_DIR = coverDir;

export const db = new Database(path.join(dataDir, "weread.db"));
db.pragma("journal_mode = WAL");

// 8 张表，表名与 PRD 附录 B 一致；字段按需微调（如 shelf_snapshot 的弃读标记与计数）
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_settings (
  vid           TEXT PRIMARY KEY,
  spoiler_level TEXT NOT NULL DEFAULT 'none',
  read_stats    TEXT,
  updated_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS book_cache (
  book_id           TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  author            TEXT,
  meta              TEXT NOT NULL DEFAULT '{}',
  cover_proxy_path  TEXT,
  cover_remote_url  TEXT,
  cover_cache_file  TEXT,
  dominant_color    TEXT,
  palette           TEXT,
  fetched_at        INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS review_cache (
  book_id       TEXT NOT NULL,
  band          TEXT NOT NULL,
  reviews       TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  PRIMARY KEY (book_id, band)
);
CREATE TABLE IF NOT EXISTS highlight (
  vid         TEXT NOT NULL,
  book_id     TEXT NOT NULL,
  chapter_uid INTEGER NOT NULL,
  chapter_idx INTEGER,
  chapter_name TEXT,
  mark_text   TEXT NOT NULL,
  color_style INTEGER,
  range       TEXT NOT NULL,
  create_time INTEGER NOT NULL,
  PRIMARY KEY (vid, book_id, range)
);
CREATE TABLE IF NOT EXISTS thought (
  vid         TEXT NOT NULL,
  book_id     TEXT NOT NULL,
  content     TEXT NOT NULL,
  abstract    TEXT,
  review_id   TEXT,
  star        INTEGER NOT NULL DEFAULT -1,
  is_finish   INTEGER NOT NULL DEFAULT 0,
  chapter_uid INTEGER,
  chapter_idx INTEGER,
  chapter_name TEXT,
  range       TEXT NOT NULL,
  create_time INTEGER NOT NULL,
  PRIMARY KEY (vid, book_id, range)
);
CREATE TABLE IF NOT EXISTS shelf_snapshot (
  vid            TEXT NOT NULL,
  book_id        TEXT NOT NULL,
  progress       REAL NOT NULL DEFAULT 0,
  finished       INTEGER NOT NULL DEFAULT 0,
  abandoned      INTEGER NOT NULL DEFAULT 0,
  read_minutes   INTEGER NOT NULL DEFAULT 0,
  last_read_at   TEXT,
  finished_at    TEXT,
  archive        TEXT,
  sort           INTEGER NOT NULL DEFAULT 0,
  note_sort      INTEGER,
  sync_time      INTEGER NOT NULL,
  PRIMARY KEY (vid, book_id)
);
CREATE TABLE IF NOT EXISTS speed_baseline (
  vid              TEXT PRIMARY KEY,
  words_per_minute REAL NOT NULL,
  basis            TEXT NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS decision_record (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vid         TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  goal        TEXT,
  topic       TEXT,
  card_json   TEXT NOT NULL,
  verdict     TEXT NOT NULL,
  action      TEXT,
  action_time INTEGER
);
`;

// 期望列清单：启动时与 PRAGMA table_info 对比，防止旧库缺列引发崩溃循环
const EXPECTED_COLUMNS: Record<string, string[]> = {
  user_settings: ["vid", "spoiler_level", "read_stats", "updated_at"],
  book_cache: ["book_id", "title", "author", "meta", "cover_proxy_path", "cover_remote_url", "cover_cache_file", "dominant_color", "palette", "fetched_at"],
  review_cache: ["book_id", "band", "reviews", "snapshot_date"],
  highlight: ["vid", "book_id", "chapter_uid", "chapter_idx", "chapter_name", "mark_text", "color_style", "range", "create_time"],
  thought: ["vid", "book_id", "content", "abstract", "review_id", "star", "is_finish", "chapter_uid", "chapter_idx", "chapter_name", "range", "create_time"],
  shelf_snapshot: ["vid", "book_id", "progress", "finished", "abandoned", "read_minutes", "last_read_at", "finished_at", "archive", "sort", "note_sort", "sync_time"],
  speed_baseline: ["vid", "words_per_minute", "basis", "updated_at"],
  decision_record: ["id", "vid", "created_at", "goal", "topic", "card_json", "verdict", "action", "action_time"]
};

db.exec(SCHEMA_SQL);

// 只做原地 additive migration。定义来自本文件常量，避免把旧库降级为重建/清空。
const ADDITIVE_COLUMNS: Record<string, Record<string, string>> = {
  user_settings: { spoiler_level: "TEXT NOT NULL DEFAULT 'none'", read_stats: "TEXT", updated_at: "INTEGER NOT NULL DEFAULT 0" },
  book_cache: {
    title: "TEXT NOT NULL DEFAULT ''", author: "TEXT", meta: "TEXT NOT NULL DEFAULT '{}'", cover_proxy_path: "TEXT",
    cover_remote_url: "TEXT", cover_cache_file: "TEXT", dominant_color: "TEXT", palette: "TEXT", fetched_at: "INTEGER NOT NULL DEFAULT 0"
  },
  review_cache: { reviews: "TEXT NOT NULL DEFAULT '[]'", snapshot_date: "TEXT NOT NULL DEFAULT ''" },
  highlight: { chapter_idx: "INTEGER", chapter_name: "TEXT", color_style: "INTEGER" },
  thought: {
    abstract: "TEXT", review_id: "TEXT", star: "INTEGER NOT NULL DEFAULT -1", is_finish: "INTEGER NOT NULL DEFAULT 0",
    chapter_uid: "INTEGER", chapter_idx: "INTEGER", chapter_name: "TEXT"
  },
  shelf_snapshot: {
    progress: "REAL NOT NULL DEFAULT 0", finished: "INTEGER NOT NULL DEFAULT 0", abandoned: "INTEGER NOT NULL DEFAULT 0",
    read_minutes: "INTEGER NOT NULL DEFAULT 0", last_read_at: "TEXT", finished_at: "TEXT", archive: "TEXT",
    sort: "INTEGER NOT NULL DEFAULT 0", note_sort: "INTEGER", sync_time: "INTEGER NOT NULL DEFAULT 0"
  },
  speed_baseline: { words_per_minute: "REAL NOT NULL DEFAULT 425", basis: "TEXT NOT NULL DEFAULT 'estimated'", updated_at: "INTEGER NOT NULL DEFAULT 0" },
  decision_record: { created_at: "INTEGER NOT NULL DEFAULT 0", goal: "TEXT", topic: "TEXT", card_json: "TEXT NOT NULL DEFAULT '{}'", verdict: "TEXT NOT NULL DEFAULT 'skip'", action: "TEXT", action_time: "INTEGER" }
};

function migrateSchema(): void {
  for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
    const actual = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name));
    for (const column of expected) {
      if (actual.has(column)) continue;
      const definition = ADDITIVE_COLUMNS[table]?.[column];
      if (!definition) throw new Error(`数据库缺少无法原地补齐的列：${table}.${column}`);
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      actual.add(column);
    }
  }
}

migrateSchema();

const seedStmts = {
  book: db.prepare(`
    INSERT OR REPLACE INTO book_cache (book_id, title, author, meta, cover_proxy_path, dominant_color, palette, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  shelf: db.prepare(`
    INSERT OR REPLACE INTO shelf_snapshot
      (vid, book_id, progress, finished, abandoned, read_minutes, last_read_at, finished_at, archive, sort, sync_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  highlight: db.prepare(`
    INSERT OR REPLACE INTO highlight (vid, book_id, chapter_uid, mark_text, range, create_time)
    VALUES (?, ?, ?, ?, ?, ?)`),
  thought: db.prepare(`
    INSERT OR REPLACE INTO thought (vid, book_id, content, abstract, range, create_time)
    VALUES (?, ?, ?, ?, ?, ?)`),
  settings: db.prepare(`INSERT OR REPLACE INTO user_settings (vid, spoiler_level, read_stats, updated_at) VALUES (?, ?, ?, ?)`),
  baseline: db.prepare(`INSERT OR REPLACE INTO speed_baseline (vid, words_per_minute, basis, updated_at) VALUES (?, ?, ?, ?)`)
};

// mock 的 read_stats 与速度基线同样落库，保证 /api/stats 两模式读取路径完全一致
export function buildMockReadStats(): { weeklyMinutes: { label: string; minutes: number }[]; monthMinutes: number } {
  const weeks = mockWeeklyMinutes();
  const currentMonth = weeks[weeks.length - 1].label.slice(0, 2);
  return {
    weeklyMinutes: weeks,
    monthMinutes: weeks
      .filter((week) => week.label.slice(0, 2) === currentMonth)
      .reduce((sum, week) => sum + week.minutes, 0)
  };
}

// 演示数据只在空库时播种；调色板在此预计算存入 book_cache（渲染时零开销）
export function seedMockIfEmpty(): void {
  const existing = db.prepare(`SELECT COUNT(*) AS count FROM shelf_snapshot WHERE vid = ?`).get(MOCK_VID) as {
    count: number;
  };
  if (existing.count > 0) return;
  const now = Math.floor(Date.now() / 1000);
  const readStats = JSON.stringify(buildMockReadStats());
  const finishedWpm = MOCK_BOOKS.filter((book) => book.finished)
    .map((book) => book.wordCount / book.readMinutes)
    .sort((a, b) => a - b);
  const medianWpm = finishedWpm[Math.floor(finishedWpm.length / 2)];
  const seed = db.transaction(() => {
    seedStmts.settings.run(MOCK_VID, "none", readStats, now);
    seedStmts.baseline.run(MOCK_VID, medianWpm, "own_median", now);
    MOCK_BOOKS.forEach((book, index) => {
      const palette = paletteFromDominant(book.color);
      seedStmts.book.run(
        book.bookId,
        book.title,
        book.author,
        JSON.stringify({ category: book.category }),
        `/api/cover/${book.bookId}`,
        book.color,
        JSON.stringify(palette),
        now
      );
      seedStmts.shelf.run(
        MOCK_VID,
        book.bookId,
        book.progress,
        book.finished ? 1 : 0,
        book.abandoned ? 1 : 0,
        book.readMinutes,
        book.lastReadAt,
        book.finishedAt,
        book.archive,
        index,
        now
      );
      for (const row of mockHighlightRows(book)) {
        seedStmts.highlight.run(MOCK_VID, row.bookId, row.chapterUid, row.text, row.range, row.createTime);
      }
      for (const row of mockThoughtRows(book)) {
        seedStmts.thought.run(MOCK_VID, row.bookId, row.text, row.abstract ?? null, row.range, row.createTime);
      }
    });
  });
  seed();
}
