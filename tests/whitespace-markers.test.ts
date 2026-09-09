import assert from "node:assert/strict";
import { whitespaceTokens } from "../src/lib/whitespace-markers";

assert.deepEqual(whitespaceTokens(" \tword \n", "off"), []);
assert.deepEqual(whitespaceTokens("a \tb\n\n", "all"), [
  { offset: 1, kind: "space" }, { offset: 2, kind: "tab" },
  { offset: 4, kind: "newline" }, { offset: 5, kind: "newline" },
]);
assert.deepEqual(whitespaceTokens("  a\n\tb\n \tc \n", "abnormal"), [
  { offset: 7, kind: "space" }, { offset: 8, kind: "tab" }, { offset: 10, kind: "space" },
]);
assert.equal(whitespaceTokens("汉字 tab\t😀", "all")[1].offset, 6);
console.log("whitespace markers: passed");
