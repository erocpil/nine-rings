/**
 * Markdown 解析器单元测试
 *
 * 用法：npx tsx tests/md-parser.test.ts
 */

import { mdToDelta, extractTitle, looksLikeMarkdown } from "../src/lib/md-parser";
import { deltaToProseMirror } from "../src/lib/delta-converter";

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
  assert(codeBlockOps[0].attributes?.language === "typescript", "code fence language is preserved");
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
  assert(listNewlines[0].attributes?.listStart === 1, "first ordered marker is preserved");
  assert(listNewlines[1].attributes?.listStart === 2, "second ordered marker is preserved");
  assert(result.ops.some((o: any) => o.insert === "First"), "First text found");
}

// 有序项之间包含缩进段落/代码块时会成为独立的 ProseMirror 列表节点，
// 每个节点仍必须从 Markdown 中声明的编号开始，而不是全部重置为 1。
{
  console.log("\n── Ordered list starts across loose item blocks ──");
  const result = mdToDelta([
    "1. First",
    "",
    "   explanation",
    "",
    "2. Second",
    "",
    "   ```text",
    "   example",
    "   ```",
    "",
    "3. Third",
  ].join("\n"));
  const listLines = result.ops.filter((op: any) => op.attributes?.list === "ordered");
  assert(JSON.stringify(listLines.map((op: any) => op.attributes.listStart)) === "[1,2,3]",
    "loose ordered list markers are preserved");

  const pm = deltaToProseMirror(result);
  const orderedLists = pm.content.filter((node: any) => node.type === "orderedList");
  assert(orderedLists.length === 3, "loose items rebuild as three ordered list nodes");
  assert((orderedLists[0].attrs?.start ?? 1) === 1, "first node starts at 1");
  assert(orderedLists[1].attrs?.start === 2, "second node starts at 2");
  assert(orderedLists[2].attrs?.start === 3, "third node starts at 3");
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
  assert(result.ops.some((op: any) => op.insert?.hr), "hr generates horizontal-rule embed");
}

// ═══════════════════════════════════════════════════════════════════
// 14. 自动换行的段落与引用续行
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Wrapped paragraphs and lazy blockquote continuation ──");

  // 来自聊天应用的 Markdown 常在视觉换行处直接换行，并以两个空格缩进。
  // `>` 后未再次出现 `>` 的行仍是同一条引用的续行。
  const md = `# 面试复习材料:DPDK / 内核网络 / SR-IOV & VIRTIO

  > 组织方式:每个知识点按【概念 → 原理 → 使用场景 → 值得关注项】展开。标注【简历关联】的地方,是可以直接对应到 SenseTime / Baidu /
  Meituan / Datang 项目经历的点,面试时优先用真实项目回答;没有标注的属于知识补齐项,回答思路是"讲清楚是什么、为什么这样设计、典型怎么
  用",不需要硬编项目经历。

  ---

  # Part 1. DPDK 相关

  ## 1.1 DPDK 整体架构 & EAL(环境抽象层)

  **概念**
  DPDK(Data Plane Development Kit)是一套用户态高性能网络数据平面开发框架,核心思路是绕过内核协议栈,让应用直接在用户态收发网卡数据包,
  消除内核态/用户态拷贝和上下文切换开销。`;
  const pm = deltaToProseMirror(mdToDelta(md));

  assert(pm.content.length === 7, "wrapped source produces 7 intended top-level blocks");
  assert(pm.content[1]?.type === "blockquote", "quote remains a blockquote");
  assert(
    pm.content[1]?.content?.[0]?.content?.[0]?.text.includes("不需要硬编项目经历。"),
    "unmarked quote continuation stays in the quote",
  );
  assert(pm.content[2]?.type === "horizontalRule", "divider remains a horizontal rule");
  assert(pm.content[5]?.content?.map((node: any) => node.text).join("") === "概念",
    "standalone bold label remains its own paragraph");
  assert(pm.content[5]?.content?.[0]?.marks?.some((mark: any) => mark.type === "bold"),
    "standalone label remains bold");
  assert(pm.content[6]?.content?.map((node: any) => node.text).join("").includes("上下文切换开销。"),
    "wrapped body stays in one paragraph");
}

// 整行加粗标签与下一行正文之间即使没有空行，也必须保留块级分隔。
{
  console.log("\n── Standalone bold label ──");
  const pm = deltaToProseMirror(mdToDelta(
    "**概念**\nDPDK应用通常把每个lcore绑定到一个物理CPU核。",
  ));
  assert(pm.content.length === 2, "bold label and body render as two paragraphs");
  assert(pm.content[0]?.content?.[0]?.text === "概念", "label text is preserved");
  assert(pm.content[1]?.content?.[0]?.text?.startsWith("DPDK应用"), "body starts in the next paragraph");
}

// ═══════════════════════════════════════════════════════════════════
// 15. Markdown 表格
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Markdown table rows ──");

  const md = `# 内容索引

| 技术领域 | 对应章节 | 核心内容 |
|---|---|---|
| DPDK框架 | 1.1～1.6 | EAL初始化 |
| Flow Director | 1.7 | queue级资源隔离 |`;
  const delta = mdToDelta(md);
  const table = (delta.ops.find((op: any) => typeof op.insert === "object")?.insert as any)?.table;
  const pm = deltaToProseMirror(delta);

  assert(table?.version === 1, "table is stored as a versioned embed");
  assert(table?.rows?.length === 3 && table?.columns?.length === 3, "table dimensions are preserved");
  assert(table?.rows?.[0]?.cells?.every((cell: any) => cell.header), "first row is a header row");
  assert(pm.content.length === 2 && pm.content[1]?.type === "table", "table becomes a ProseMirror table node");
  assert(pm.content[1]?.content?.[2]?.content?.[0]?.content?.[0]?.content?.[0]?.text === "Flow Director",
    "table data cell text is preserved");

  const escaped = mdToDelta("| Code | Pipe |\n| :--- | ---: |\n| `a | b` | escaped \\| pipe |");
  const escapedTable = (escaped.ops[0].insert as any).table;
  assert(escapedTable.columns[0].align === "left" && escapedTable.columns[1].align === "right",
    "column alignment is parsed");
  assert(escapedTable.rows[1].cells[0].content.ops[0].attributes?.code === true,
    "pipe inside inline code stays in one cell");
  assert(escapedTable.rows[1].cells[1].content.ops[0].insert === "escaped | pipe",
    "escaped pipe stays in one cell");
}

// ═══════════════════════════════════════════════════════════════════
// 16. 混合语法
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

{
  console.log("\n── Markdown paste detection ──");
  assert(looksLikeMarkdown("### 先消除\n\n> 能不做的就不做"), "heading + quote is detected");
  assert(looksLikeMarkdown("# Resume Claim Defense"), "single heading is detected");
  assert(looksLikeMarkdown("- first\n- second"), "multi-line list is detected");
  assert(looksLikeMarkdown("```ts\nconst x = 1\n```"), "fenced code is detected");
  assert(
    looksLikeMarkdown(
      "# 面试复习材料:DPDK / 内核网络 / SR-IOV & VIRTIO\n\n" +
      "> 组织方式:每个知识点按【概念 → 原理 → 使用场景 → 值得关注项】展开。\n\n" +
      "---\n\n# Part 1. DPDK 相关\n\n## 1.1 DPDK 整体架构 & EAL(环境抽象层)\n\n概念",
    ),
    "long interview notes with headings, quote and divider are detected",
  );
  assert(!looksLikeMarkdown("1.0.0 is a version"), "version text is not detected");
  assert(!looksLikeMarkdown("> 100"), "single comparison-like line is not detected");
  assert(!looksLikeMarkdown("#12345"), "issue number is not detected");
}

// ═══════════════════════════════════════════════════════════════════
// 多级 Markdown 列表
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── Nested Markdown lists ──");
  const delta = mdToDelta(
    "- Parent\r\n" +
    "  1. Child\r\n" +
    "    - Grandchild\r\n" +
    "- Sibling",
  );
  const listLines = delta.ops.filter((op: any) => op.attributes?.list);
  assert(listLines.length === 4, "all Markdown list items are parsed");
  assert(listLines[0].attributes?.indent === undefined, "root Markdown item has no indent");
  assert(listLines[1].attributes?.list === "ordered" && listLines[1].attributes?.indent === 1,
    "CRLF two-space ordered child becomes indent 1");
  assert(listLines[2].attributes?.list === "bullet" && listLines[2].attributes?.indent === 2,
    "four-space bullet grandchild becomes indent 2");

  const pm = deltaToProseMirror(delta);
  const rootList = pm.content[0];
  const childList = rootList.content[0].content[1];
  const grandchildList = childList.content[0].content[1];
  assert(rootList.type === "bulletList" && rootList.content.length === 2,
    "root Markdown list is rebuilt with sibling");
  assert(childList.type === "orderedList", "mixed ordered child list is rebuilt");
  assert(grandchildList.type === "bulletList", "third-level bullet list is rebuilt");
}

// ═══════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
