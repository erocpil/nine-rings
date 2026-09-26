import assert from "node:assert/strict";
import { diffDocumentLines } from "../src/lib/document-diff";

const original = Array.from(
  { length: 800 },
  (_, index) => `line-${index}`,
).join("\n");
const withBlankLine = [
  ...original.split("\n").slice(0, 400),
  "",
  ...original.split("\n").slice(400),
].join("\n");
const result = diffDocumentLines(original, withBlankLine);

assert.equal(result.coarse, false, "少量差异不应触发粗略回退");
assert.equal(result.lines.filter((line) => line.kind === "added").length, 1);
assert.equal(result.lines.filter((line) => line.kind === "removed").length, 0);
assert.equal(result.lines.filter((line) => line.kind === "same").length, 800);
assert.equal(result.lines.find((line) => line.kind === "added")?.text, "");

console.log("Document diff alignment passed");
