import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GatewayClient, ReviewListResponse } from "../server/src/gateway.js";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "weread-review-cache-"));
process.env.WEREAD_MODE = "mock";
process.env.WEREAD_DATA_DIR = dataDir;

try {
  const { db } = await import("../server/src/db.js");
  const { fetchReviewListCached, fetchReviewListCachedWithDate } = await import("../server/src/decide/engine.js");
  const response: ReviewListResponse = {
    reviewsCnt: 1,
    reviewsHasMore: 0,
    reviews: [],
    deepVRecommendValue: 800,
    errcode: 0
  };
  let calls = 0;
  let latestResponse = response;
  const gateway = {
    fetchReviewList: async () => {
      calls += 1;
      return latestResponse;
    }
  } as unknown as GatewayClient;

  const first = await fetchReviewListCached(gateway, "cache-check-book", "recommend");
  assert.equal(first.reviewsCnt, 1);
  assert.equal(calls, 1, "首次读取应请求网关");

  const hit = await fetchReviewListCached(gateway, "cache-check-book", "recommend");
  assert.deepEqual(hit, first);
  assert.equal(calls, 1, "有效缓存命中时不得再次请求网关");

  db.prepare(`UPDATE review_cache SET snapshot_date = ? WHERE book_id = ? AND band = ?`).run(
    new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    "cache-check-book",
    "recommend"
  );
  latestResponse = { ...response, reviewsCnt: 2 };
  const refreshed = await fetchReviewListCached(gateway, "cache-check-book", "recommend");
  assert.equal(refreshed.reviewsCnt, 2);
  assert.equal(calls, 2, "缓存过期后应重新请求网关");

  const stored = db
    .prepare(`SELECT reviews, snapshot_date FROM review_cache WHERE book_id = ? AND band = ?`)
    .get("cache-check-book", "recommend") as { reviews: string; snapshot_date: string };
  assert.equal(JSON.parse(stored.reviews).reviewsCnt, 2);
  assert.ok(Date.now() - Date.parse(stored.snapshot_date) < 5000, "刷新后应更新快照时间");
  const dated = await fetchReviewListCachedWithDate(gateway, "cache-check-book", "recommend");
  assert.equal(dated.snapshotDate, stored.snapshot_date, "缓存读取应带回实际快照日期");
  db.close();
  console.log("review cache checks passed");
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
