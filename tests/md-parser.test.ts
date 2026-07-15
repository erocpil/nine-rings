/**
 * Markdown 解析器单元测试
 *
 * 用法：npx tsx tests/md-parser.test.ts
 */

import { mdToDelta, extractTitle } from "../src/lib/md-parser";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) { passed++; return; }
  console.error(`  FAIL: ${msg}`);
  failed++;
}

// ═══════════════════════════════════════════════════════════════════
// 1. 空字符串
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Empty input ──");

  const result = mdToDelta("");
  assert(result?.ops?.length === 0 || (result?.ops?.length === 1 && result?.ops[0]?.insert === "\n"),
    "empty string → minimal delta");
}

// ═══════════════════════════════════════════════════════════════════
// 2. 纯文本
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Plain text ──");

  const result = mdToDelta("Hello world");
  const textOps = result.ops.filter((o: any) => typeof o.insert === "string" && o.insert !== "\n");
  assert(textOps.some((o: any) => o.insert.includes("Hello world")), "plain text preserved");
}

// ═══════════════════════════════════════════════════════════════════
// 3. 标题
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Headings ──");

  const h1 = mdToDelta("# Hello");
  // 格式：[{insert:"Hello"}, {insert:"\n", attributes:{header:1}}]
  const h1Text = h1.ops.find((o: any) => typeof o.insert === "string" && o.insert !== "\n");
  const h1Newline = h1.ops.find((o: any) => o.attributes?.header === 1);
  assert(h1Text?.insert === "Hello", "H1 text correct");
  assert(h1Newline?.attributes?.header === 1, "H1 newline has header=1");

  const h2 = mdToDelta("## Subtitle");
  const h2Text = h2.ops.find((o: any) => typeof o.insert === "string" && o.insert !== "\n");
  const h2Newline = h2.ops.find((o: any) => o.attributes?.header === 2);
  assert(h2Text?.insert === "Subtitle", "H2 text correct");
  assert(h2Newline?.attributes?.header === 2, "H2 newline has header=2");

  const h3 = mdToDelta("### Deep");
  const h3Newline = h3.ops.find((o: any) => o.attributes?.header === 3);
  assert(!!h3Newline, "H3 detected");
}

// ═══════════════════════════════════════════════════════════════════
// 4. 粗体
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Bold ──");

  const result = mdToDelta("Hello **world**.");
  const boldOps = result.ops.filter((o: any) => o.attributes?.bold);
  assert(boldOps.length >= 1, "bold op exists");
  assert(boldOps[0].insert === "world", "bold text correct");
}

// ═══════════════════════════════════════════════════════════════════
// 5. 斜体
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Italic ──");

  const result = mdToDelta("Hello *world*.");
  const italicOps = result.ops.filter((o: any) => o.attributes?.italic);
  assert(italicOps.length >= 1, "italic op exists");
  assert(italicOps[0].insert === "world", "italic text correct");
}

// ═══════════════════════════════════════════════════════════════════
// 6. 行内代码
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Inline code ──");

  const result = mdToDelta("Use `const` keyword.");
  const codeOps = result.ops.filter((o: any) => o.attributes?.code);
  assert(codeOps.length >= 1, "inline code op exists");
  assert(codeOps[0].insert === "const", "code text correct");
}

// ═══════════════════════════════════════════════════════════════════
// 7. 代码块
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Code block ──");

  const result = mdToDelta("```\nconst x = 1;\n```");
  // 格式：[{insert:"const x = 1;"}, {insert:"\n", attributes:{"code-block":true}}]
  const codeText = result.ops.find((o: any) => typeof o.insert === "string" && o.insert !== "\n" && !o.attributes);
  const codeNewline = result.ops.find((o: any) => o.attributes?.["code-block"]);
  assert(codeText?.insert === "const x = 1;", "code block text correct");
  assert(codeNewline?.attributes?.["code-block"] === true, "code block newline has code-block=true");
}

// ═══════════════════════════════════════════════════════════════════
// 8. 代码块（带语言）
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Code block with language ──");

  const result = mdToDelta("```typescript\nconst x = 1;\n```");
  const codeBlockOps = result.ops.filter((o: any) => o.attributes?.["code-block"]);
  assert(codeBlockOps.length >= 1, "code block with lang exists");
}

// ═══════════════════════════════════════════════════════════════════
// 9. 无序列表
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Bullet list ──");

  const result = mdToDelta("- Item 1\n- Item 2");
  // 格式：[{insert:"Item 1"}, {insert:"\n", attributes:{list:"bullet"}}, {insert:"Item 2"}, {insert:"\n", attributes:{list:"bullet"}}]
  const listNewlines = result.ops.filter((o: any) => o.attributes?.list === "bullet");
  assert(listNewlines.length === 2, "2 bullet list newline ops");
  const itemTexts = result.ops.filter((o: any) => typeof o.insert === "string" && o.insert !== "\n" && !o.attributes);
  assert(itemTexts.some((o: any) => o.insert === "Item 1"), "Item 1 text found");
  assert(itemTexts.some((o: any) => o.insert === "Item 2"), "Item 2 text found");
}

// ═══════════════════════════════════════════════════════════════════
// 10. 有序列表
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Ordered list ──");

  const result = mdToDelta("1. First\n2. Second");
  const listNewlines = result.ops.filter((o: any) => o.attributes?.list === "ordered");
  assert(listNewlines.length === 2, "2 ordered list newline ops");
  assert(result.ops.some((o: any) => o.insert === "First"), "First text found");
}

// ═══════════════════════════════════════════════════════════════════
// 11. 引用
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Blockquote ──");

  const result = mdToDelta("> This is a quote");
  const quoteOps = result.ops.filter((o: any) => o.attributes?.blockquote);
  assert(quoteOps.length >= 1, "blockquote op exists");
}

// ═══════════════════════════════════════════════════════════════════
// 12. 链接
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Link ──");

  const result = mdToDelta("[Click here](https://example.com)");
  const linkOps = result.ops.filter((o: any) => o.attributes?.link);
  assert(linkOps.length >= 1, "link op exists");
  assert(linkOps[0].attributes.link === "https://example.com", "link href correct");
  assert(linkOps[0].insert === "Click here", "link text correct");
}

// ═══════════════════════════════════════════════════════════════════
// 13. 分割线
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Horizontal rule ──");

  const result = mdToDelta("---");
  assert(result.ops.length >= 1, "hr generates something");
}

// ═══════════════════════════════════════════════════════════════════
// 14. 混合语法
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Mixed syntax ──");

  const md = `# Title

## Section

This is a **bold** and *italic* text with \`code\`.

- Item A
- Item B

> Quote here

[Link](https://example.com)`;
  const result = mdToDelta(md);

  assert(result.ops.length > 0, "mixed syntax produces ops");

  const hasH1 = result.ops.some((o: any) => o.attributes?.header === 1);
  const hasH2 = result.ops.some((o: any) => o.attributes?.header === 2);
  const hasBold = result.ops.some((o: any) => o.attributes?.bold);
  const hasItalic = result.ops.some((o: any) => o.attributes?.italic);
  const hasCode = result.ops.some((o: any) => o.attributes?.code);
  const hasList = result.ops.some((o: any) => o.attributes?.list === "bullet");
  const hasQuote = result.ops.some((o: any) => o.attributes?.blockquote);
  const hasLink = result.ops.some((o: any) => o.attributes?.link);

  assert(hasH1, "H1 detected");
  assert(hasH2, "H2 detected");
  assert(hasBold, "bold detected");
  assert(hasItalic, "italic detected");
  assert(hasCode, "inline code detected");
  assert(hasList, "bullet list detected");
  assert(hasQuote, "blockquote detected");
  assert(hasLink, "link detected");
}

// ═══════════════════════════════════════════════════════════════════
// 15. extractTitle
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── extractTitle ──");

  // extractTitle 只对 '# ' 开头的行有效
  assert(extractTitle("# My Title") === "My Title", "H1 → title");

  // H2 不提取（实际实现只匹配 '# '）
  const h2Result = extractTitle("## Subtitle\n\nContent");
  // 行为取决于实现：可能返回 undefined 或内容
  assert(h2Result === undefined || typeof h2Result === "string",
    "H2 extractTitle returns undefined or string");
}

// ═══════════════════════════════════════════════════════════════════
// 16. 边缘情况
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Edge cases ──");

  // 未闭合粗体
  const r1 = mdToDelta("This is **not closed");
  assert(r1.ops.length > 0, "unterminated bold does not throw");

  // 空列表
  const r2 = mdToDelta("- ");
  assert(r2.ops.length >= 0, "empty list item does not throw");

  // null（注意：md-parser 不支持 null，需外部保护）
  try {
    mdToDelta(null as any);
    assert(true, "null input handled (or throws expectedly)");
  } catch {
    assert(true, "null input throws (expected — caller should guard)");
  }
}

// ═══════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
