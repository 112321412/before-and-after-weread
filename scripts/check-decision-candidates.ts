import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "weread-decision-candidates-"));
process.env.WEREAD_MODE = "mock";
process.env.WEREAD_DATA_DIR = dataDir;

try {
  const { isValidDecisionSelection, MAX_DECISION_CANDIDATES } = await import("../server/src/decide/types.js");
  assert.equal(MAX_DECISION_CANDIDATES, 3);
  assert.equal(isValidDecisionSelection(["book-a"], "book-a"), true);
  assert.equal(isValidDecisionSelection(["book-a", "book-b", "book-c"], "book-b"), true);
  assert.equal(isValidDecisionSelection(["book-a", "book-b", "book-c", "book-d"], "book-a"), false);
  assert.equal(isValidDecisionSelection(["book-a", "book-a"], "book-a"), false);
  assert.equal(isValidDecisionSelection(undefined, "book-a"), false);
  assert.equal(isValidDecisionSelection(["book-a", "book-b"], "book-c"), false);

  const source = await readFile(new URL("../web/src/pages/DecidePage.tsx", import.meta.url), "utf8");
  assert.match(source, /disabled=\{!selected\.has\(candidate\.bookId\) && selected\.size >= MAX_DECISION_CANDIDATES\}/);
  assert.match(source, /已达上限，最多选择 3 本/);
  console.log("decision candidate checks passed");
} finally {
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
