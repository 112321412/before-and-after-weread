import assert from "node:assert/strict";
import { isFinishedReading, readingSeconds, resolveWordCount } from "../server/src/reading.js";

assert.equal(isFinishedReading({ progress: 99, finishTime: 1770000000 }), true);
assert.equal(isFinishedReading({ progress: 99 }), false);
assert.equal(isFinishedReading({ progress: 100 }), true);
assert.equal(readingSeconds({ readingTime: 3600, recordReadingTime: 99999 }), 3600);
assert.equal(readingSeconds({ recordReadingTime: 120 }), 120);
assert.equal(resolveWordCount(1200, [300, 400]), 1200);
assert.equal(resolveWordCount(0, [300, 400, undefined]), 700);

console.log("reading baseline checks passed");
