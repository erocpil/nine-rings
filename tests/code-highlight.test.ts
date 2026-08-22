import assert from "node:assert/strict";
import {
  CODE_LANGUAGE_OPTIONS,
  MAX_HIGHLIGHT_CODE_LENGTH,
  highlightCode,
  normalizeCodeLanguage,
} from "../src/lib/code-highlight";

assert.equal(normalizeCodeLanguage("TS"), "typescript");
assert.equal(normalizeCodeLanguage("html"), "xml");
assert.equal(normalizeCodeLanguage("plaintext"), null);
assert.equal(normalizeCodeLanguage("unsupported-language"), null);
assert(CODE_LANGUAGE_OPTIONS.length <= 18, "only the curated common language set is exposed");

const tokens = highlightCode('const answer: number = 42; // result', "typescript");
assert(tokens.some((token) => token.classes.includes("hljs-keyword")), "TypeScript keyword highlighted");
assert(tokens.some((token) => token.classes.includes("hljs-number")), "number highlighted");
assert(tokens.some((token) => token.classes.includes("hljs-comment")), "comment highlighted");
assert.deepEqual(highlightCode("const answer = 42", "plaintext"), []);
assert.deepEqual(highlightCode("x".repeat(MAX_HIGHLIGHT_CODE_LENGTH + 1), "javascript"), [],
  "oversized code blocks fall back to plain text");

console.log("Code syntax highlighting passed");
