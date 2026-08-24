import assert from "node:assert/strict";
import { isWeReadKey } from "../server/src/key.js";

assert.equal(isWeReadKey("  wrk-demo-key  "), true);
assert.equal(isWeReadKey("not-a-weread-key"), false);
assert.equal(isWeReadKey(""), false);
assert.equal(isWeReadKey("wrk-"), false);

console.log("key guard checks passed");
