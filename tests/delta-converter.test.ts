/**
 * Delta 转换器单元测试
 *
 * 用法：npx tsx tests/delta-converter.test.ts
 */

import { deltaToProseMirror, proseMirrorToDelta, pxToNamed, namedToPx } from "../src/lib/delta-converter";
import { deltaToMarkdown } from "../src/lib/markdown-serializer";
import { extractPlainText } from "../src/lib/storage/core";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) { passed++; return; }
  console.error(`  FAIL: ${msg}`);
  failed++;
}

// ═══════════════════════════════════════════════════════════════════
// 1. 字体大小映射
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Font size mapping ──");
  assert(pxToNamed(10) === "small", "10px → small");
  assert(pxToNamed(14) === "small", "14px → small");
  assert(pxToNamed(16) === "normal", "16px → normal");
  assert(pxToNamed(18) === "large", "18px → large");
  assert(pxToNamed(24) === "huge", "24px → huge");
  assert(pxToNamed(32) === "huge", "32px → huge");
  assert(namedToPx("small") === 14, "small → 14px");
  assert(namedToPx("normal") === 16, "normal → 16px");
  assert(namedToPx("large") === 18, "large → 18px");
  assert(namedToPx("huge") === 24, "huge → 24px");
  assert(namedToPx("unknown") === 16, "unknown → 16px");
}

// ═══════════════════════════════════════════════════════════════════
// 2. 纯文本段落
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Plain paragraph ──");
  const pm: any = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }] };
  const delta = proseMirrorToDelta(pm);
  assert(delta.ops.length === 2, "plain text → 2 ops");
  assert(delta.ops[0].insert === "Hello world", "first op is Hello world");
  assert(delta.ops[1].insert === "\n", "second op is newline");
}

// ═══════════════════════════════════════════════════════════════════
// 3. 粗体和斜体
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Bold and italic ──");
  const pm: any = { type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "Hello ", marks: [{ type: "bold" }] },
    { type: "text", text: "world", marks: [{ type: "italic" }] },
  ]}] };
  const delta = proseMirrorToDelta(pm);
  assert(delta.ops.length === 3, `bold+italic → 3 ops (got ${delta.ops.length})`);
  assert(delta.ops[0].attributes?.bold === true, "first op bold=true");
  assert(delta.ops[1].attributes?.italic === true, "second op italic=true");
}

// ═══════════════════════════════════════════════════════════════════
// 4. 链接
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Links ──");
  const pm: any = { type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "Click here", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
  ]}] };
  const delta = proseMirrorToDelta(pm);
  assert(delta.ops[0].attributes?.link === "https://example.com", "link href preserved");
}

// ═══════════════════════════════════════════════════════════════════
// 5. 标题
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Headings ──");
  const pm: any = { type: "doc", content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Sub" }] },
  ]};
  const delta = proseMirrorToDelta(pm);
  const headerOps = delta.ops.filter((o: any) => o.attributes?.header);
  assert(headerOps.length === 2, "2 heading newline ops");
  assert(headerOps[0].attributes.header === 1, "H1");
  assert(headerOps[1].attributes.header === 2, "H2");
}

// ═══════════════════════════════════════════════════════════════════
// 6. 代码块
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Code block ──");
  const pm: any = { type: "doc", content: [{ type: "codeBlock", attrs: { language: "typescript" }, content: [{ type: "text", text: "const x = 1;" }] }] };
  const delta = proseMirrorToDelta(pm);
  // 格式：[{insert:"const x = 1;"}, {insert:"\n", attributes:{"code-block":true}}]
  const codeText = delta.ops.find((o: any) => typeof o.insert === "string" && o.insert !== "\n" && !o.attributes);
  const codeNl = delta.ops.find((o: any) => o.attributes?.["code-block"]);
  assert(codeText?.insert === "const x = 1;", "code block text correct");
  assert(codeNl?.attributes?.["code-block"] === true, "code block newline has code-block=true");
}

// ═══════════════════════════════════════════════════════════════════
// 7. 引用块
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Blockquote ──");
  const pm: any = { type: "doc", content: [{ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Quote me" }] }] }] };
  const delta = proseMirrorToDelta(pm);
  const quoteOp = delta.ops.find((o: any) => o.attributes?.blockquote);
  assert(!!quoteOp, "blockquote op exists");
}

// ═══════════════════════════════════════════════════════════════════
// 8. 无序列表
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Bullet list ──");
  const pm: any = { type: "doc", content: [{ type: "bulletList", content: [
    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item 1" }] }] },
    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item 2" }] }] },
  ]}] };
  const delta = proseMirrorToDelta(pm);
  // 格式：[{insert:"Item 1"}, {insert:"\n", attributes:{list:"bullet"}}, {insert:"Item 2"}, {insert:"\n", attributes:{list:"bullet"}}]
  const bulletNls = delta.ops.filter((o: any) => o.attributes?.list === "bullet");
  assert(bulletNls.length === 2, "2 bullet list newline ops");
  assert(delta.ops.some((o: any) => o.insert === "Item 1"), "Item 1 text found");
  assert(delta.ops.some((o: any) => o.insert === "Item 2"), "Item 2 text found");
}

// ═══════════════════════════════════════════════════════════════════
// 9. 有序列表
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Ordered list ──");
  const pm: any = { type: "doc", content: [{ type: "orderedList", content: [
    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] },
  ]}] };
  const delta = proseMirrorToDelta(pm);
  const orderedNl = delta.ops.find((o: any) => o.attributes?.list === "ordered");
  assert(!!orderedNl, "ordered list newline op exists");
  assert(orderedNl.attributes.listStart === 1, "ordered list start is stored in Delta");
}

{
  console.log("\n── Ordered list custom start ──");
  const pm: any = { type: "doc", content: [{ type: "orderedList", attrs: { start: 4 }, content: [
    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Fourth" }] }] },
    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Fifth" }] }] },
  ] }] };
  const delta = proseMirrorToDelta(pm);
  const starts = delta.ops.filter((op: any) => op.attributes?.list === "ordered")
    .map((op: any) => op.attributes.listStart);
  assert(JSON.stringify(starts) === "[4,5]", "ordered item numbers survive PM to Delta");
  assert(JSON.stringify(deltaToProseMirror(delta)) === JSON.stringify(pm),
    "custom ordered list start survives save and reload");
  assert(deltaToMarkdown(delta) === "4. Fourth\n5. Fifth",
    "Markdown export keeps explicit ordered item numbers");
}

// ═══════════════════════════════════════════════════════════════════
// 10. 分割线
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Horizontal rule ──");
  const pm: any = { type: "doc", content: [{ type: "horizontalRule" }] };
  const delta = proseMirrorToDelta(pm);
  assert(delta.ops.length >= 1, "horizontal rule generates ops");

  const restored = deltaToProseMirror({
    ops: [
      { insert: { hr: true } },
      { insert: "\n" },
      { insert: "下一节" },
      { insert: "\n", attributes: { header: 1 } },
    ],
  });
  assert(restored.content.length === 2, "horizontal rule terminator does not create an empty paragraph");
  assert(restored.content[1]?.type === "heading", "content after horizontal rule remains adjacent heading");
}

// ═══════════════════════════════════════════════════════════════════
// 11. 空文档
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Empty document ──");
  const r1 = proseMirrorToDelta({ type: "doc" });
  assert(r1.ops != null, "empty doc → valid delta");
  const r2 = proseMirrorToDelta({ type: "doc", content: [] });
  assert(r2.ops != null, "empty content → valid delta");
  const r3 = proseMirrorToDelta(null);
  assert(r3 != null, "null → returns something");
  const r4 = deltaToProseMirror({ ops: [] });
  assert(r4.content?.length === 1, "empty delta → one editable block");
  assert(r4.content?.[0]?.type === "paragraph", "empty delta → editable paragraph");
}

// ═══════════════════════════════════════════════════════════════════
// 12. 表格
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Table ──");
  const pm: any = { type: "doc", content: [{ type: "table", content: [
    { type: "tableRow", content: [
      { type: "tableHeader", attrs: { textAlign: "left", colwidth: [180] }, content: [{ type: "paragraph", content: [{ type: "text", text: "Name", marks: [{ type: "bold" }] }] }] },
      { type: "tableHeader", attrs: { textAlign: "right", colwidth: [240] }, content: [{ type: "paragraph", content: [{ type: "text", text: "Value" }] }] },
    ] },
    { type: "tableRow", content: [
      { type: "tableCell", attrs: { textAlign: "left" }, content: [{ type: "paragraph", content: [{ type: "text", text: "a | b", marks: [{ type: "code" }] }] }] },
      { type: "tableCell", attrs: { textAlign: "right" }, content: [{ type: "paragraph", content: [{ type: "text", text: "42" }] }] },
    ] },
  ] }] };
  const delta = proseMirrorToDelta(pm);
  const table = delta.ops[0]?.insert?.table;
  const restored = deltaToProseMirror(delta);
  assert(table?.version === 1 && table?.rows?.length === 2, "table serializes to a versioned embed");
  assert(table?.columns?.[0]?.width === 180 && table?.columns?.[1]?.width === 240,
    "table column widths survive serialization");
  assert(restored.content[0]?.type === "table", "table embed restores a table node");
  assert(restored.content[0]?.content?.[0]?.content?.[1]?.attrs?.colwidth?.[0] === 240,
    "table column widths survive restoration");
  assert(restored.content[0]?.content?.[1]?.content?.[0]?.content?.[0]?.content?.[0]?.text === "a | b",
    "table cell content survives save and reload");
  const markdown = deltaToMarkdown(delta);
  assert(markdown.includes("| **Name** | Value |"), "table header exports to Markdown");
  assert(markdown.includes("| :--- | ---: |"), "table alignment exports to Markdown");
  assert(markdown.includes("`a \\| b`"), "table pipe is escaped on Markdown export");
  assert(extractPlainText(delta).includes("Name\tValue\na | b\t42"), "table cells are searchable");

  const legacy = deltaToProseMirror({ ops: [
    { insert: "| A | B |" }, { insert: "\n" },
    { insert: "| --- | --- |" }, { insert: "\n" },
    { insert: "| 1 | 2 |" }, { insert: "\n" },
  ] });
  assert(legacy.content[0]?.type === "table", "legacy pipe paragraphs migrate to a table");
}

// ═══════════════════════════════════════════════════════════════════
// 13. 多重标记
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Multiple marks ──");
  const pm: any = { type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "Bold Italic", marks: [{ type: "bold" }, { type: "italic" }] },
  ]}] };
  const delta = proseMirrorToDelta(pm);
  assert(delta.ops[0].attributes?.bold === true, "bold mark");
  assert(delta.ops[0].attributes?.italic === true, "italic mark");
}

// ═══════════════════════════════════════════════════════════════════
// 14. 删除线 + 行内代码
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Strike + inline code ──");
  const pm: any = { type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "struck", marks: [{ type: "strike" }] },
    { type: "text", text: "code", marks: [{ type: "code" }] },
  ]}] };
  const delta = proseMirrorToDelta(pm);
  const strikeOp = delta.ops.find((o: any) => o.insert === "struck");
  const codeOp = delta.ops.find((o: any) => o.insert === "code");
  assert(strikeOp?.attributes?.strike === true, "strike mark");
  assert(codeOp?.attributes?.code === true, "code mark");
}

// ═══════════════════════════════════════════════════════════════════
// 15. 多级混合列表双向转换
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Nested mixed lists ──");
  const pm: any = { type: "doc", content: [{ type: "bulletList", content: [
    { type: "listItem", content: [
      { type: "paragraph", content: [{ type: "text", text: "Parent" }] },
      { type: "orderedList", content: [
        { type: "listItem", content: [
          { type: "paragraph", content: [{ type: "text", text: "Child" }] },
          { type: "bulletList", content: [
            { type: "listItem", content: [
              { type: "paragraph", content: [{ type: "text", text: "Grandchild" }] },
            ] },
          ] },
        ] },
      ] },
    ] },
    { type: "listItem", content: [
      { type: "paragraph", content: [{ type: "text", text: "Sibling" }] },
    ] },
  ] }] };

  const delta = proseMirrorToDelta(pm);
  const listLines = delta.ops.filter((op: any) => op.attributes?.list);
  assert(listLines.length === 4, "all nested list items are preserved");
  assert(listLines[0].attributes.indent === undefined, "root item has no indent");
  assert(listLines[1].attributes.list === "ordered" && listLines[1].attributes.indent === 1,
    "ordered child has indent 1");
  assert(listLines[2].attributes.list === "bullet" && listLines[2].attributes.indent === 2,
    "bullet grandchild has indent 2");
  assert(JSON.stringify(deltaToProseMirror(delta)) === JSON.stringify(pm),
    "nested mixed list survives save and reload");
}

// ═══════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
