import assert from "node:assert/strict";
import { isWeReadKey } from "../server/src/key.js";

assert.equal(isWeReadKey("  any-valid-key  "), true);
assert.equal(isWeReadKey("not-a-weread-key"), true);
assert.equal(isWeReadKey(""), false);
assert.equal(isWeReadKey("   "), false);

console.log("key guard checks passed");
