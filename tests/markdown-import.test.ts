import { buildMarkdownImportInput, buildTextImportInput, decodeTextImport, isTextImportFile, normalizeMarkdownImportPath, parseMetadataList } from "../src/lib/markdown-import";

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

const options = { date: "2026-09-16", mode: "document" as const, storagePath: "references/imported", tags: ["text"] };
const plain = buildTextImportInput({ fileName: "原文.TXT", relativePath: "资料/网络/原文.TXT", source: "# 不是标题\r\n**原样保留**\r末行" }, options);
assert(plain.title === "原文", "plain text title comes from filename, not a Markdown heading");
assert(plain.storagePath === "references/imported/资料/网络", "selected root and nested folders are preserved");
assert(JSON.stringify(plain.content) === JSON.stringify({ ops: [{ insert: "# 不是标题\n**原样保留**\n末行\n" }] }), "plain text is literal and CRLF/CR are normalized");
const markdown = buildTextImportInput({ fileName: "intro.markdown", source: "# 标题", relativePath: "资料/intro.markdown" }, options);
assert(markdown.title === "标题" && markdown.storagePath === "references/imported/资料", "markdown extension retains parsing and root folder");
assert(buildTextImportInput({ fileName: "empty.txt", source: "" }, options).content?.ops[0].insert === "\n", "empty text files remain valid documents");
assert(isTextImportFile("事件.LOG") && !isTextImportFile("image.png") && !isTextImportFile("report.pdf"), "supported formats are case insensitive and binaries excluded");
for (const relativePath of ["../test.txt", "资料/../test.txt", "/资料/test.txt", "C:\\资料\\test.txt", "资料/other.txt", "资料//test.txt"]) {
  let rejected = false;
  try { buildTextImportInput({ fileName: "test.txt", source: "", relativePath }, options); } catch { rejected = true; }
  assert(rejected, `reject invalid relative path ${relativePath}`);
}
assert(decodeTextImport(new TextEncoder().encode("中文\n")) === "中文\n", "UTF-8 decoding");
assert(decodeTextImport(new Uint8Array([255, 254, 45, 78])) === "中", "UTF-16 LE BOM decoding");
assert(decodeTextImport(new Uint8Array([254, 255, 78, 45])) === "中", "UTF-16 BE BOM decoding");
for (const bytes of [new Uint8Array([0, 65]), new Uint8Array([255, 255])]) {
  let rejected = false;
  try { decodeTextImport(bytes); } catch { rejected = true; }
  assert(rejected, "binary or invalid encoding is reported, never silently mangled");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
