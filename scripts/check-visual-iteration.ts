import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RecallDraft } from "../web/src/types.js";

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [shelfPage, shelfState, topNav, theme, globalCss, shelfCss, shelfScene, textures, staticShelf, reviewPage, appSource, apiSource] =
  await Promise.all([
    source("web/src/pages/ShelfPage.tsx"),
    source("web/src/shelfState.ts"),
    source("web/src/components/TopNav.tsx"),
    source("web/src/theme.ts"),
    source("web/src/styles/global.css"),
    source("web/src/styles/shelf.css"),
    source("web/src/shelf3d/ShelfScene.ts"),
    source("web/src/shelf3d/textures.ts"),
    source("web/src/shelf3d/StaticShelf.tsx"),
    source("web/src/pages/ReviewPage.tsx"),
    source("web/src/App.tsx"),
    source("web/src/api.ts")
  ]);

// 同步环、TopNav 和阅读数据门控：数值只来自 SyncProgress，入口还要等待统计成功。
assert.match(shelfPage, /className="shelf-hero-background"/);
assert.match(shelfPage, /<SyncOrbit sync=\{sync\}/);
assert.match(shelfPage, /role="progressbar"/);
assert.match(shelfPage, /syncPercent\(sync\)/);
assert.match(shelfPage, /syncStageLabel\(sync\)/);
assert.doesNotMatch(shelfPage, /Math\.round\(progress\.percent/);
const hintIndex = shelfPage.indexOf('className="scroll-hint"');
assert.ok(hintIndex >= 0, "书架必须保留下滑入口");
const hintGate = shelfPage.lastIndexOf("{showReadingData &&", hintIndex);
assert.ok(hintGate >= 0, "下滑入口必须由统计数据完成门控");
assert.doesNotMatch(shelfPage.slice(hintGate, hintIndex), /\{canBrowse/);
assert.match(shelfPage, /showReadingData && stats \? <StatsSection stats=\{stats\}/);
assert.match(shelfPage, /setStats\(null\)/);
assert.match(shelfPage, /phase === "error"/);
assert.doesNotMatch(topNav, /%|percent|stage/i, "TopNav 不应渲染百分比或阶段进度");

// 错误态的两个动作必须分离：重试只刷新当前会话，更换 Key 要走会话失效和 sid 清理。
assert.match(shelfPage, /onRetry: \(\) => void/);
assert.match(shelfPage, /onChangeKey: \(\) => void/);
assert.match(shelfPage, /onClick=\{onRetry\}[\s\S]*重试同步/);
assert.match(shelfPage, /onClick=\{onChangeKey\}[\s\S]*更换 Key/);
const changeKeyAction = shelfPage.slice(shelfPage.indexOf("onClick={onChangeKey}"), shelfPage.indexOf("onClick={onChangeKey}") + 180);
assert.doesNotMatch(changeKeyAction, /window\.location\.reload/);
assert.match(appSource, /destroySessionAndClearSid\(\)/);
assert.match(appSource, /setPhase\("setup"\)/);
assert.match(apiSource, /await api\.destroySession\(\)/);
assert.match(apiSource, /clearSid\(\)/);

const { canBrowseShelf, canShowReadingData } = await import("../web/src/shelfState.js");
const syncing = { phase: "notes", current: 2, total: 4, percent: 0.5 } as const;
const done = { phase: "done", current: 4, total: 4, percent: 1 } as const;
const error = { phase: "error", current: 0, total: 0, percent: 0, error: "同步失败" } as const;
assert.equal(canBrowseShelf(syncing, true, 2), false);
assert.equal(canShowReadingData(syncing, true, 2, true), false, "同步中不得显示阅读数据");
assert.equal(canShowReadingData(done, true, 2, false), false, "统计未载入时不得显示下滑入口");
assert.equal(canShowReadingData(done, true, 2, true), true, "同步完成且统计载入后才开放阅读数据");
assert.equal(canShowReadingData(done, true, 0, true), false, "空书架不得伪装成完成的阅读数据");
assert.equal(canShowReadingData(error, true, 0, true), false, "同步错误不得显示伪造的 0 数据");
assert.match(shelfState, /phase === "done" && booksLoaded && bookCount > 0/);

// 主题作用域：只写 hero 的局部变量，应用外壳继续使用稳定令牌。
assert.doesNotMatch(theme, /document\.documentElement/);
assert.match(theme, /target\.style\.setProperty\("--shelf-paper"/);
assert.match(shelfPage, /applyPalette\(book\.palette, heroRef\.current\)/);
assert.match(globalCss, /应用外壳使用稳定中性令牌/);

// 三维与静态降级的封面都保留原图颜色，并维持正常深度缓冲。
assert.match(shelfScene, /new THREE\.MeshBasicMaterial/);
assert.match(shelfScene, /depthTest: true/);
assert.match(shelfScene, /depthWrite: true/);
assert.doesNotMatch(shelfScene, /depthTest: false/);
assert.doesNotMatch(shelfScene, /coverMaterial\.color\.copy\(dominant\)/);
assert.doesNotMatch(textures, /edgeShade/);
assert.match(shelfCss, /filter: none/);
assert.match(shelfCss, /mix-blend-mode: normal/);
assert.match(staticShelf, /书架背景/);

// F2.2：用临时 SQLite 验证素材门槛、规则生成与 vid 隔离，不触碰项目数据目录。
const dataDir = await mkdtemp(path.join(os.tmpdir(), "weread-visual-"));
const previousMode = process.env.WEREAD_MODE;
const previousDataDir = process.env.WEREAD_DATA_DIR;
process.env.WEREAD_MODE = "mock";
process.env.WEREAD_DATA_DIR = dataDir;

let db: { close: () => void } | undefined;
try {
  const importedDb = await import("../server/src/db.js");
  db = importedDb.db;
  const { buildTheme } = await import("../server/src/review/theme.js");

  const insertBook = importedDb.db.prepare(
    `INSERT INTO book_cache (book_id, title, meta, fetched_at) VALUES (?, ?, ?, ?)`
  );
  insertBook.run("theme-book-a", "主题书甲", "{}", 1);
  insertBook.run("theme-book-b", "主题书乙", "{}", 1);
  insertBook.run("theme-book-other", "另一主题书", "{}", 1);

  const insertHighlight = importedDb.db.prepare(
    `INSERT INTO highlight
      (vid, book_id, chapter_uid, chapter_idx, chapter_name, mark_text, color_style, range, create_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const addHighlight = (vid: string, bookId: string, range: string, text: string) =>
    insertHighlight.run(vid, bookId, 1, 1, "第一章", text, 1, range, 1);

  addHighlight("visual-vid-a", "theme-book-a", "a-1", "组织需要边界");
  const insufficient = await buildTheme("visual-vid-a", "组织");
  assert.equal(insufficient.insufficient, true, "跨书素材不足时不得生成主题");

  addHighlight("visual-vid-a", "theme-book-a", "a-2", "组织需要反馈");
  addHighlight("visual-vid-a", "theme-book-b", "b-1", "组织如何学习");
  addHighlight("visual-vid-a", "theme-book-b", "b-2", "组织需要复盘");
  addHighlight("visual-vid-b", "theme-book-other", "other-1", "组织来自他人的经验");

  const generated = await buildTheme("visual-vid-a", "组织");
  assert.equal(generated.insufficient, false, "覆盖两本书且达到四条记录后应生成主题");
  assert.equal(generated.totalMatches, 4);
  assert.ok(generated.themes.length > 0, "规则模式应形成至少一个主题");
  assert.equal(generated.books.length, 2);
  assert.equal(generated.books.includes("主题书甲"), true);
  assert.equal(generated.books.includes("主题书乙"), true);
  assert.equal(generated.evidences.some((evidence) => evidence.text.includes("他人的经验")), false, "主题不得串入其他 vid");
} finally {
  try {
    db?.close();
  } catch {
    // 关闭失败时由进程退出回收临时检查库。
  }
  if (previousMode === undefined) delete process.env.WEREAD_MODE;
  else process.env.WEREAD_MODE = previousMode;
  if (previousDataDir === undefined) delete process.env.WEREAD_DATA_DIR;
  else process.env.WEREAD_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

// F2.3：编辑只影响生成段落，证据原文只能被移除，不能被编辑改写。
const { buildRecallMarkdown } = await import("../web/src/pages/ReviewPage.js");
const recall: RecallDraft = {
  bookId: "theme-book-a",
  title: "检查书",
  framework: "finished",
  llm: "rules",
  headlineNote: null,
  sections: [{ title: "收获", paragraphs: ["原始段落"], evidenceIds: ["keep", "remove"] }],
  evolution: [],
  evidences: [
    {
      id: "keep",
      kind: "highlight",
      text: "必须保留的原文",
      context: null,
      chapterUid: 1,
      chapterIdx: 1,
      chapterName: "第一章",
      colorStyle: 1,
      colorMeaning: "红色",
      createTime: 1
    },
    {
      id: "remove",
      kind: "highlight",
      text: "用户明确删除的证据",
      context: null,
      chapterUid: 1,
      chapterIdx: 1,
      chapterName: "第一章",
      colorStyle: 1,
      colorMeaning: "红色",
      createTime: 1
    }
  ],
  myReviews: [],
  readingTrace: { currentProgress: 100, readMinutes: 10, finishedAt: null, inference: "推断", chapters: [] },
  meta: { progress: 100, readMinutes: 10, finishedAt: null, lastReadAt: null, highlightCount: 2, thoughtCount: 0 }
};
const markdown = buildRecallMarkdown(recall, ["编辑后的段落"], [{ start: 0, end: 1 }], new Set(["remove"]));
assert.match(markdown, /编辑后的段落/);
assert.match(markdown, /必须保留的原文/);
assert.doesNotMatch(markdown, /用户明确删除的证据/);
const evidenceQuote = reviewPage.slice(reviewPage.indexOf("function EvidenceQuote"), reviewPage.indexOf("function quoteMeta"));
assert.match(evidenceQuote, /<p>\{text\}<\/p>/);
assert.doesNotMatch(evidenceQuote, /value=\{text\}/);

console.log("visual iteration checks passed");
