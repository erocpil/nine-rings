import { buildMarkdownImportInput, normalizeMarkdownImportPath, parseMetadataList } from "../src/lib/markdown-import";

let passed = 0;
let failed = 0;
const assert = (condition: boolean, message: string) => {
  if (condition) passed++;
  else { failed++; console.error(`  FAIL: ${message}`); }
};

console.log("\n── Markdown import metadata ──");

assert(normalizeMarkdownImportPath(" /references\\networking// ") === "references/networking",
  "destination paths are normalized");
assert(JSON.stringify(parseMetadataList("DPDK, 网络，DPDK\n性能")) === JSON.stringify(["DPDK", "网络", "性能"]),
  "metadata lists are trimmed and deduplicated");

const documentInput = buildMarkdownImportInput("review.md", "# Review\r\n\r\n- item", {
  date: "2026-08-19",
  mode: "document",
  storagePath: "references/networking",
  docType: "reference",
  tags: ["imported"],
  concepts: ["DPDK"],
});
assert(documentInput.title === "Review", "first H1 becomes the imported title");
assert(documentInput.storagePath === "references/networking", "document destination is persisted");
assert(documentInput.docType === "reference", "document type is persisted");
assert(documentInput.tags?.[0] === "imported" && documentInput.concepts?.[0] === "DPDK",
  "tags and concepts are persisted");
assert(documentInput.content?.ops.some((op) => op.attributes?.list === "bullet") === true,
  "CRLF Markdown content is parsed during import");

const noteInput = buildMarkdownImportInput("scratch.md", "plain text", {
  date: "2026-08-19",
  mode: "note",
  storagePath: "ignored/path",
  docType: "tutorial",
});
assert(noteInput.title === "scratch", "filename is used when no H1 exists");
assert(noteInput.storagePath === undefined && noteInput.docType === undefined,
  "note imports do not accidentally enter the document tree");

let invalidPathRejected = false;
try {
  buildMarkdownImportInput("bad.md", "text", {
    date: "2026-08-19",
    mode: "document",
    storagePath: "references/../private",
  });
} catch {
  invalidPathRejected = true;
}
assert(invalidPathRejected, "ambiguous parent-directory paths are rejected");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
