import assert from "node:assert/strict";
import {
  cacheEditorDocument,
  clearEditorSessionCache,
  getCachedEditorDocument,
  promoteCachedEditorDocument,
} from "../src/lib/editor-session-cache";

clearEditorSessionCache();
const first = { type: "doc", content: [{ type: "paragraph" }] };
cacheEditorDocument("a", "v1", first);
assert.equal(getCachedEditorDocument("a", "v1"), first);
assert.equal(getCachedEditorDocument("a", "v2"), null, "revision mismatch must not use stale content");
promoteCachedEditorDocument("a", "v2");
assert.equal(getCachedEditorDocument("a", "v2"), first, "autosave revision promotion keeps converted content");

const second = { type: "doc", content: [{ type: "heading" }] };
const third = { type: "doc", content: [{ type: "blockquote" }] };
cacheEditorDocument("b", "v1", second);
assert.equal(getCachedEditorDocument("a", "v2"), first, "cache hit refreshes LRU position");
cacheEditorDocument("c", "v1", third);
assert.equal(getCachedEditorDocument("b", "v1"), null, "cache keeps only the two most recent sessions");
assert.equal(getCachedEditorDocument("a", "v2"), first);
assert.equal(getCachedEditorDocument("c", "v1"), third);

console.log("Editor session cache passed");
