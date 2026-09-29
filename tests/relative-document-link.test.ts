import { strict as assert } from "node:assert";
import { isRelativeMarkdownLink, resolveRelativeDocumentLink, type LinkDocument } from "../src/lib/relative-document-link";

const source: LinkDocument = { id: "boot", title: "第 1 章：启动", storagePath: "references/LaOS/docs/book", originalFileName: "01-boot-zh.md" };
const memory: LinkDocument = { id: "memory", title: "第 2 章：内存", storagePath: "references/LaOS/docs/book", originalFileName: "02-memory-zh.md" };
const design: LinkDocument = { id: "design", title: "启动架构", storagePath: "references/LaOS/docs/design/boot", originalFileName: "boot-arch-zh.md" };
const docs = [source, memory, design];

assert.equal(isRelativeMarkdownLink("02-memory-zh.md"), true);
assert.equal(isRelativeMarkdownLink("../design/boot/boot-arch-zh.md#overview"), true);
assert.equal(isRelativeMarkdownLink("https://example.com/02-memory-zh.md"), false);
assert.equal(isRelativeMarkdownLink("javascript:alert(1)"), false);
assert.equal(resolveRelativeDocumentLink(source, "02-memory-zh.md", "内存", docs)?.exact?.id, "memory");
assert.equal(resolveRelativeDocumentLink(source, "../design/boot/boot-arch-zh.md", "启动架构", docs)?.exact?.id, "design");
assert.equal(resolveRelativeDocumentLink(source, "../../../../outside.md", "外部", docs), null);
assert.deepEqual(resolveRelativeDocumentLink(source, "02-memory-zh.md", "内存", [source, { ...memory, originalFileName: undefined }])?.suggestions.map(note => note.id), ["memory"]);
assert.equal(resolveRelativeDocumentLink(source, "02-memory-zh.md", "内存", [source, { ...memory, originalFileName: undefined }])?.exact, null);
assert.equal(resolveRelativeDocumentLink(source, "02-memory-zh.md", "内存", [source, { ...memory, storagePath: "references/Other/docs/book" }])?.exact, null);
console.log("Relative document links passed");
