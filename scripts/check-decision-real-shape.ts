import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BookInfoResponse, GatewayClient, ReviewListResponse } from "../server/src/gateway.js";
import type { Session } from "../server/src/sync.js";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "weread-decision-real-shape-"));
process.env.WEREAD_MODE = "mock";
process.env.WEREAD_DATA_DIR = dataDir;

let closeDb: (() => void) | undefined;

const emptyReviewList = (): ReviewListResponse => ({ reviewsCnt: 0, reviewsHasMore: 0, reviews: [] });

try {
  const { db } = await import("../server/src/db.js");
  closeDb = () => db.close();
  const { normalizeRating, resolveWordCount } = await import("../server/src/reading.js");
  const { createMockGateway } = await import("../server/src/mock/gateway.js");
  const { buildCandidates, buildCard } = await import("../server/src/decide/engine.js");
  const { parseIntentRules } = await import("../server/src/decide/rules.js");

  assert.equal(normalizeRating(867), 86.7);
  assert.equal(normalizeRating(86.7), 86.7);
  assert.equal(normalizeRating(1001), 100);
  assert.equal(resolveWordCount(0, [60_000, 40_000]), 100_000);

  const base = createMockGateway();
  let detailCalls = 0;
  const candidateGateway = {
    ...base,
    fetchStoreSearch: async () => ({
      sid: "fixture-search",
      hasMore: 0,
      results: [
        {
          title: "fixture",
          scope: 10,
          books: [
            {
              searchIdx: 0,
              bookInfo: { bookId: "search-book", title: "搜索书", author: "搜索作者", intro: "搜索简介" },
              newRating: 867,
              newRatingCount: 100
            }
          ]
        }
      ]
    }),
    fetchSimilar: async () => ({
      booksimilar: {
        sessionId: "fixture-similar",
        books: [
          { idx: 0, book: { bookInfo: { bookId: "similar-good", title: "相似好书", author: "相似作者" } } },
          { idx: 1, book: { bookInfo: { bookId: "similar-bad", title: "相似降级书", author: "相似作者" } } }
        ]
      }
    }),
    fetchBookInfo: async (bookId: string): Promise<BookInfoResponse> => {
      detailCalls += 1;
      if (bookId === "similar-bad") throw new Error("fixture detail failure");
      return {
        bookId,
        title: "相似好书详情",
        author: "相似作者详情",
        intro: "详情简介",
        wordCount: 10_000,
        newRating: 867,
        newRatingCount: 80
      };
    }
  } as GatewayClient;
  const candidateSession: Session = { sid: "sid-candidates", vid: "vid-candidates", gateway: candidateGateway, createdAt: 1 };
  const candidates = await buildCandidates(candidateSession, parseIntentRules("组织"), 0);
  const searchBook = candidates.candidates.find((candidate) => candidate.bookId === "search-book");
  const hydrated = candidates.candidates.find((candidate) => candidate.bookId === "similar-good");
  const degraded = candidates.candidates.find((candidate) => candidate.bookId === "similar-bad");
  assert.equal(searchBook?.rating, 86.7, "搜索顶层 867 应归一为 86.7");
  assert.equal(hydrated?.rating, 86.7, "相似书详情评分应归一为 86.7");
  assert.equal(hydrated?.intro, "详情简介");
  assert.equal(degraded?.rating, 0, "单本详情失败应保留无评分降级");
  assert.equal(degraded?.intro, "", "单本详情失败应保留空简介降级");
  assert.equal(detailCalls, 2, "只对最终页的两本缺字段相似书请求详情");

  const chapters = [
    { chapterUid: 1, chapterIdx: 1, title: "第一章", wordCount: 60_000, level: 0 },
    { chapterUid: 2, chapterIdx: 2, title: "第二章", wordCount: 40_000, level: 0 }
  ];
  const oldBookInfo: BookInfoResponse = {
    bookId: "old-cache-book",
    title: "旧缓存书",
    author: "旧缓存作者",
    wordCount: 0,
    newRating: 867,
    newRatingCount: 100,
    category: "社科",
    intro: "旧缓存简介"
  };
  db.prepare(`INSERT INTO speed_baseline (vid, words_per_minute, basis, updated_at) VALUES (?, ?, ?, ?)`)
    .run("vid-card", 100, "estimated", 1);
  db.prepare(`INSERT INTO book_cache (book_id, title, author, meta, fetched_at) VALUES (?, ?, ?, ?, ?)`)
    .run("old-cache-book", oldBookInfo.title, oldBookInfo.author, JSON.stringify({ bookInfo: oldBookInfo, chapters }), 1);

  const cardGateway = {
    ...base,
    fetchBestBookmarks: async () => ({ totalCount: 0, items: [], chapters: [] }),
    fetchReviewList: async () => emptyReviewList(),
    fetchSimilar: async () => ({ booksimilar: { sessionId: "empty", books: [] } }),
    fetchBookInfo: async (bookId: string) => ({ ...oldBookInfo, bookId, title: "新缓存书" }),
    fetchChapterInfo: async (bookId: string) => ({ bookId, chapters })
  } as GatewayClient;
  const cardSession: Session = { sid: "sid-card", vid: "vid-card", gateway: cardGateway, createdAt: 1 };
  const intent = parseIntentRules("我想理解组织");
  const oldCard = await buildCard(cardSession, "old-cache-book", intent);
  assert.equal(oldCard.book.rating, 86.7, "读取旧缓存时应实时修复 867");
  assert.equal(oldCard.book.wordCount, 100_000, "书目信息为 0 时应使用章节字数和");
  assert.ok((oldCard.readingCost.estimatedHours ?? 0) > 0, "章节字数回退后预计时长必须大于 0");
  assert.equal(oldCard.readingCost.wordCountSource, "chapters");
  assert.doesNotMatch(oldCard.openQuestions.join("\n"), /有效字数缺失/);

  await buildCard(cardSession, "new-cache-book", intent);
  const stored = db.prepare(`SELECT meta FROM book_cache WHERE book_id = ?`).get("new-cache-book") as { meta: string };
  assert.equal(JSON.parse(stored.meta).bookInfo.newRating, 86.7, "新写入缓存应保存规范化评分");

  const zeroCardGateway = {
    ...cardGateway,
    fetchBookInfo: async (bookId: string) => ({ ...oldBookInfo, bookId, title: "待校准书", wordCount: 0 }),
    fetchChapterInfo: async (bookId: string) => ({ bookId, chapters: [] })
  } as GatewayClient;
  const zeroCard = await buildCard({ ...cardSession, gateway: zeroCardGateway }, "zero-word-book", intent);
  assert.equal(zeroCard.book.wordCount, 0);
  assert.equal(zeroCard.readingCost.estimatedHours, null, "没有任何字数来源时不得输出 0 小时");
  assert.equal(zeroCard.readingCost.wordCountSource, "unknown");
  assert.match(zeroCard.readingCost.calendarEstimate, /待校准/);

  console.log("decision real-shape checks passed");
} finally {
  try {
    closeDb?.();
  } catch {
    // 数据库已关闭时无需重复处理。
  }
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
