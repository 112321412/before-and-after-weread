import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GatewayClient, ShelfSyncResponse } from "../server/src/gateway.js";
import type { Session } from "../server/src/sync.js";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "weread-decision-history-"));
process.env.WEREAD_MODE = "mock";
process.env.WEREAD_DATA_DIR = dataDir;
let closeDb: (() => void) | undefined;

try {
  const { db } = await import("../server/src/db.js");
  closeDb = () => db.close();
  const { createMockGateway } = await import("../server/src/mock/gateway.js");
  const { parseIntentRules } = await import("../server/src/decide/rules.js");
  const { resolveFollowupIntent } = await import("../web/src/intent.js");
  const {
    buildCard,
    listDecisions,
    listReadingList,
    rejudgeDecision
  } = await import("../server/src/decide/engine.js");
  const { cacheShelfFromGateway } = await import("../server/src/sync.js");

  const previous = parseIntentRules("这本怎么样");
  const forced = resolveFollowupIntent(
    { ...previous, mode: "ambiguous", topic: "", followupChips: ["系统了解一个领域"] },
    previous,
    "系统了解一个领域"
  );
  assert.equal(forced.mode, "topic", "chip 选择后必须离开 ambiguous");
  assert.equal(forced.goalType, "systematic");
  assert.equal(forced.followupChips, undefined);

  const insertDecision = (vid: string, cardId: string, bookId: string, action: string, trigger: string | null) => {
    db.prepare(
      `INSERT INTO decision_record (vid, created_at, goal, topic, card_json, verdict, action, action_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      vid,
      1,
      "systematic",
      "测试主题",
      JSON.stringify({
        card: { cardId, book: { bookId, title: "测试书", author: "测试作者" } },
        trigger,
        reason: null
      }),
      "shelve",
      action,
      1
    );
  };
  insertDecision("vid-a", "card-a", "book-a", "shelve", "周末有时间");
  insertDecision("vid-b", "card-b", "book-a", "skip", null);
  const original = listDecisions("vid-a")[0];
  assert.equal(original.action, "shelve");
  assert.equal(original.trigger, "周末有时间");
  rejudgeDecision("vid-a", original.id, { action: "skip", reason: "暂不需要" });
  const afterSkip = listDecisions("vid-a");
  assert.equal(afterSkip.length, 2, "改判必须追加新记录，不能覆盖旧记录");
  assert.equal(afterSkip[0].action, "skip");
  assert.equal(afterSkip[1].action, "shelve");
  assert.equal(listReadingList("vid-a").length, 0, "改判移出待读后应为空");
  rejudgeDecision("vid-a", afterSkip[0].id, { action: "shelve", trigger: "月底复盘" });
  assert.equal(listReadingList("vid-a")[0]?.trigger, "月底复盘", "再次改判为待读应保留触发条件");
  assert.equal(listReadingList("vid-b").length, 0, "待读列表必须按 vid 隔离");
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS count FROM decision_record WHERE vid = ?`).get("vid-a") as { count: number }).count,
    3
  );

  const base = createMockGateway();
  let infoCalls = 0;
  let chapterCalls = 0;
  const gateway = {
    ...base,
    fetchBookInfo: async (bookId: string) => {
      infoCalls += 1;
      return base.fetchBookInfo(bookId);
    },
    fetchChapterInfo: async (bookId: string) => {
      chapterCalls += 1;
      return base.fetchChapterInfo(bookId);
    }
  } as GatewayClient;
  const session: Session = { sid: "sid-cache", vid: "vid-cache", gateway, createdAt: 1 };
  const intent = parseIntentRules("我想理解组织为什么失灵，但不想读太学术的书");
  const firstCard = await buildCard(session, "store-001", intent);
  await buildCard(session, "store-001", intent);
  assert.equal(infoCalls, 1, "同书第二次决策应复用 book_cache 元数据");
  assert.equal(chapterCalls, 1, "同书第二次决策应复用本地章节");
  const cached = db.prepare(`SELECT title, meta FROM book_cache WHERE book_id = ?`).get("store-001") as { title: string; meta: string };
  assert.equal(cached.title, firstCard.book.title);
  assert.ok(JSON.parse(cached.meta).bookInfo);
  assert.ok(Array.isArray(JSON.parse(cached.meta).chapters));

  const shelf: ShelfSyncResponse = {
    books: [
      {
        bookId: "store-001",
        title: "书架短标题",
        author: "书架作者",
        category: "社科",
        cover: null,
        progress: 0,
        readUpdateTime: 1,
        finishReading: 0
      }
    ],
    archive: [],
    bookCount: 1
  };
  cacheShelfFromGateway(session.vid, shelf);
  const preserved = db.prepare(`SELECT title, meta FROM book_cache WHERE book_id = ?`).get("store-001") as { title: string; meta: string };
  assert.equal(preserved.title, firstCard.book.title, "书架同步不得覆盖更完整书籍元数据");
  assert.equal(JSON.parse(preserved.meta).bookInfo.title, firstCard.book.title);

  const decideSource = await readFile(new URL("../web/src/pages/DecidePage.tsx", import.meta.url), "utf8");
  assert.match(decideSource, /resolveFollowupIntent\(parsed, followup\.previous, followup\.chip\)/);
  assert.match(decideSource, /setActed\(action\);\s*onActed\(\);/);
  const listSource = await readFile(new URL("../web/src/pages/ReadingListPage.tsx", import.meta.url), "utf8");
  assert.match(listSource, /不会写回微信读书/);
  console.log("decision history and metadata checks passed");
} finally {
  try {
    closeDb?.();
  } catch {
    // already closed
  }
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
