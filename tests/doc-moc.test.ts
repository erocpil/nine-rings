import assert from "node:assert/strict";
import { relativeDocumentSubpath } from "../src/lib/doc-moc";

assert.equal(relativeDocumentSubpath("a/b", "a"), "b");
assert.equal(relativeDocumentSubpath("a/c/deep", "a"), "c/deep");
assert.equal(relativeDocumentSubpath("a", "a"), ".");
assert.equal(relativeDocumentSubpath("outside/path", "a"), "outside/path");
assert.equal(relativeDocumentSubpath("a\\b", "a"), "b");

console.log("Document MOC relative paths passed");
