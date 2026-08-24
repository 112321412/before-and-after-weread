import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GatewayHttpError } from "../server/src/gateway.js";
import type { Session } from "../server/src/sync.js";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "weread-account-data-"));
process.env.WEREAD_MODE = "mock";
process.env.WEREAD_DATA_DIR = dataDir;
let closeDb: (() => void) | undefined;

try {
  const { db } = await import("../server/src/db.js");
  closeDb = () => db.close();
  const { accountVidFromKey } = await import("../server/src/key.js");
  const { deletePersonalDataAndSession, isSpoilerLevel, loadPersonalData } = await import("../server/src/account/router.js");
  const { sessions } = await import("../server/src/sessions.js");
  const { SYNC_ERROR_MESSAGE, runFullSync, syncStates } = await import("../server/src/sync.js");

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
    .run("vid-b", "book-b", 1, "b", "b-1", 1);
  db.prepare(`INSERT INTO thought (vid, book_id, content, abstract, range, create_time) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("vid-a", "book-a", "thought", null, "thought-1", 1);
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
  assert.equal(count(`SELECT COUNT(*) AS count FROM highlight WHERE vid = ?`, "vid-b"), 1);
  assert.equal(count(`SELECT COUNT(*) AS count FROM user_settings WHERE vid = ?`, "vid-b"), 1);
  assert.equal(count(`SELECT COUNT(*) AS count FROM book_cache WHERE book_id = ?`, "shared-book"), 1);
  assert.equal(count(`SELECT COUNT(*) AS count FROM review_cache WHERE book_id = ?`, "shared-book"), 1);

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
