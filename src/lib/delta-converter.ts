/**
 * ProseMirror JSON ↔ Quill Delta JSON 双向转换
 *
 * Web 端 (TipTap) 用 ProseMirror 格式，
 * Flutter 端 (flutter_quill) 用 Quill Delta 格式。
 * 数据库 content 字段统一存 Quill Delta，
 * Web 端读写时做转换。
 */

import type { JSONContent } from "@tiptap/core";
import type { DeltaOp, DeltaOps } from "../types/models";
import { splitDeltaLines } from "./plain-text-delta";

import { getTableEmbed, normalizeTableAlignment, normalizeTableColumnWidth, type TableEmbed } from "./table-embed";
import { markdownTableToEmbed } from "./md-parser";

// ── 字体大小映射 ──

/** px → Quill named */
export function pxToNamed(px: number): string {
  if (px <= 12) return "small";
  if (px <= 14) return "small";
  if (px <= 16) return "normal";
  if (px <= 18) return "large";
  if (px <= 20) return "large";
  if (px <= 24) return "huge";
  return "huge";
}

/** Quill named → px */
export function namedToPx(name: string): number {
  switch (name) {
    case "small":  return 14;
    case "normal": return 16;
    case "large":  return 18;
    case "huge":   return 24;
    default:       return 16;
  }
}

// ── Mark 转换映射 ──

/** ProseMirror mark → Delta attribute (含字体大小映射) */
function pmMarkToAttr(mark: NonNullable<JSONContent["marks"]>[number]): Record<string, unknown> | null {
  switch (mark.type) {
    case "bold":      return { bold: true };
    case "italic":    return { italic: true };
    case "strike":    return { strike: true };
    case "code":      return { code: true };
    case "link":      return { link: mark.attrs?.href ?? "" };
    case "textStyle": {
      const attrs: Record<string, unknown> = {};
      if (mark.attrs?.fontSize) {
        attrs.size = pxToNamed(Number(mark.attrs.fontSize));
      }
      if (mark.attrs?.color) {
        attrs.color = mark.attrs.color;
      }
      return Object.keys(attrs).length > 0 ? attrs : null;
    }
    default:
      return null;
  }
}

/** Delta attribute → ProseMirror mark data（含字体大小反向映射） */
function deltaAttrToMarks(attrs: Record<string, unknown> | undefined): NonNullable<JSONContent["marks"]> {
  if (!attrs) return [];
  const marks: NonNullable<JSONContent["marks"]> = [];
  if (attrs.bold)      marks.push({ type: "bold" });
  if (attrs.italic)    marks.push({ type: "italic" });
  if (attrs.strike)    marks.push({ type: "strike" });
  if (attrs.code)      marks.push({ type: "code" });
  if (attrs.link)      marks.push({ type: "link", attrs: { href: attrs.link } });
  if (attrs.color)     marks.push({ type: "textStyle", attrs: { color: attrs.color } });
  if (attrs.size) {
    const px = namedToPx(String(attrs.size));
    marks.push({ type: "textStyle", attrs: { fontSize: String(px) } });
  }
  return marks;
}

// ── ProseMirror → Quill Delta ──

export function proseMirrorToDelta(pmJson: JSONContent | null | undefined): DeltaOps {
  const ops: DeltaOp[] = [];
  const content = pmJson?.content ?? [];
  const indentAttrs = (node: { attrs?: Record<string, unknown> }) => {
    const indent = Math.max(0, Math.min(8, Math.floor(Number(node.attrs?.indent) || 0)));
    return indent > 0 ? { indent } : {};
  };

  for (const node of content) {
    switch (node.type) {
      case "paragraph":
        extractInlineOps(node, ops);
        ops.push({ insert: "\n", ...(node.attrs?.indent > 0 ? { attributes: indentAttrs(node) } : {}) });
        break;

      case "heading":
        extractInlineOps(node, ops);
        ops.push({ insert: "\n", attributes: { header: node.attrs?.level ?? 1, ...indentAttrs(node) } });
        break;

      case "bulletList":
        appendListOps(node, ops, 0);
        break;

      case "orderedList":
        appendListOps(node, ops, 0);
        break;

      case "codeBlock":
        extractInlineOps(node, ops);
        ops.push({
          insert: "\n",
          attributes: {
            "code-block": true,
            ...indentAttrs(node),
            ...(node.attrs?.language ? { language: node.attrs.language } : {}),
            ...(node.attrs?.title ? { "code-title": node.attrs.title } : {}),
            ...(node.attrs?.wrap === false ? { "code-wrap": false } : {}),
            ...(node.attrs?.collapsed === true ? { "code-collapsed": true } : {}),
          },
        });
        break;

      case "blockquote":
        {
          const attributes = {
            blockquote: true,
            ...indentAttrs(node),
            ...(node.attrs?.collapsed === true ? { "blockquote-collapsed": true } : {}),
          };
          const blocks = node.content?.length ? node.content : [{ type: "paragraph", content: [] }];
          // 一个 ProseMirror blockquote 可以包含多个段落。每个段落都写成
          // 带 blockquote 属性的 Delta 行，避免保存后把段落文字直接拼接。
          for (const block of blocks) {
            extractInlineOps(block, ops);
            ops.push({ insert: "\n", attributes });
          }
        }
        break;

      case "image":
      case "resizableImage":
        ops.push({ insert: { image: node.attrs?.src ?? "" } });
        ops.push({ insert: "\n" });
        break;

      case "horizontalRule":
        ops.push({ insert: { hr: true } });
        ops.push({ insert: "\n" });
        break;

      case "table":
        ops.push({ insert: { table: tableNodeToEmbed(node) } });
        ops.push({ insert: "\n" });
        break;
    }
  }

  return { ops };
}

function tableNodeToEmbed(tableNode: JSONContent): TableEmbed {
  const rows = (tableNode.content ?? []).map((row) => ({
    cells: (row.content ?? []).map((cell) => {
      const cellOps: DeltaOp[] = [];
      const blocks = cell.content ?? [];
      blocks.forEach((block, index) => {
        if (index > 0) cellOps.push({ insert: "\n" });
        extractInlineOps(block, cellOps);
      });
      return {
        ...(cell.type === "tableHeader" ? { header: true } : {}),
        content: { ops: cellOps },
      };
    }),
  }));
  const columnCount = Math.max(0, ...rows.map((row) => row.cells.length));
  const columns = Array.from({ length: columnCount }, (_, column) => {
    let width: number | null = null;
    for (const row of tableNode.content ?? []) {
      const cell = row.content?.[column];
      const align = normalizeTableAlignment(cell?.attrs?.textAlign);
      width ??= normalizeTableColumnWidth(cell?.attrs?.colwidth?.[0]);
      if (align) return { align, ...(width ? { width } : {}) };
    }
    return { align: null, ...(width ? { width } : {}) };
  });
  return { version: 1, columns, rows };
}

/**
 * Quill 用换行属性表示列表项，并用 indent 表示嵌套深度。按文档顺序
 * 递归输出，避免 TipTap 中可正常显示的子列表在保存时被跳过。
 */
function appendListOps(listNode: JSONContent, ops: DeltaOp[], depth: number): void {
  const list = listNode.type === "orderedList" ? "ordered" : "bullet";
  const orderedStart = list === "ordered"
    ? Math.max(1, Math.floor(Number(listNode.attrs?.start) || 1))
    : undefined;

  for (const [itemIndex, item] of (listNode.content ?? []).entries()) {
    let emittedItemLine = false;
    const lineAttributes = {
      list,
      ...(typeof item.attrs?.taskChecked === "boolean" ? { taskChecked: item.attrs.taskChecked } : {}),
      ...(depth > 0 ? { indent: depth } : {}),
      ...(orderedStart !== undefined ? { listStart: orderedStart + itemIndex } : {}),
    };

    for (const child of item.content ?? []) {
      if (child.type === "bulletList" || child.type === "orderedList") {
        // 非法或外部来源的空父项仍要保留一个可挂载子列表的列表项。
        if (!emittedItemLine) {
          ops.push({
            insert: "\n",
            attributes: lineAttributes,
          });
          emittedItemLine = true;
        }
        appendListOps(child, ops, depth + 1);
        continue;
      }

      if (["paragraph", "codeBlock", "blockquote"].includes(child.type ?? "")) {
        // Keep normal Delta text/formatting for older readers, with explicit
        // continuation metadata so a multi-block item is not flattened into items.
        const childOps = child.type === "paragraph"
          ? (() => { const result: DeltaOp[] = []; extractInlineOps(child, result); result.push({ insert: "\n" }); return result; })()
          : proseMirrorToDelta({ type: "doc", content: [child] }).ops;
        for (const op of childOps) {
          if (op.insert === "\n" && op.attributes?.["hard-break"] !== true) {
            ops.push({ ...op, attributes: { ...op.attributes, ...lineAttributes,
              ...(emittedItemLine ? { "list-continuation": true } : {}),
              ...(!emittedItemLine && itemIndex === 0 ? { "list-block-start": true } : {}),
            } });
            emittedItemLine = true;
          } else ops.push(op);
        }
      }
    }

    if (!emittedItemLine) {
      ops.push({
        insert: "\n",
        attributes: lineAttributes,
      });
    }
  }
}

function extractInlineOps(
  node: JSONContent,
  ops: DeltaOp[],
  inheritAttrs?: Record<string, unknown>,
): void {
  const inlineContent = node.content ?? [];
  for (const inline of inlineContent) {
    if (inline.type === "text") {
      const attrs: Record<string, unknown> = { ...inheritAttrs };
      for (const mark of inline.marks ?? []) {
        const attr = pmMarkToAttr(mark);
        if (attr) Object.assign(attrs, attr);
      }
      ops.push({
        insert: inline.text ?? "",
        ...(Object.keys(attrs).length > 0 ? { attributes: attrs } : {}),
      });
    } else if (inline.type === "hardBreak") {
      // 块内换行与 Delta 的块结束符都是 `\n`，必须显式区分。
      // 否则内存中的 <br> 会在自动保存后被还原成新段落。
      ops.push({ insert: "\n", attributes: { "hard-break": true } });
    } else if (inline.type === "image" || inline.type === "resizableImage") {
      ops.push({ insert: { image: inline.attrs?.src ?? "" } });
    } else if (inline.type === "paragraph" || inline.type === "listItem") {
      // 递归提取嵌套文本（如 listItem → paragraph → text）
      extractInlineOps(inline, ops, inheritAttrs);
    }
  }
}

// ── Quill Delta → ProseMirror ──

export function deltaToProseMirror(value: unknown): JSONContent & { content: JSONContent[] } {
  // 兼容两种入参：{ops: [...]} 或 {delta: {ops: [...]}}
  const deltaData = value as { ops?: DeltaOp[]; delta?: DeltaOps; metadata?: DeltaOps["metadata"] } | null | undefined;
  const rawOps = deltaData?.ops ?? deltaData?.delta?.ops ?? [];
  // Earlier plain-text imports stored the whole file as one unformatted op
  // (or several unformatted ops after saving). Restore their block boundaries.
  // Do not split intentional multiline code/list continuation operations.
  const legacyPlainText = rawOps.some(op => typeof op.insert === "string" && op.insert !== "\n" && /[\r\n]/.test(op.insert))
    && rawOps.every(op => typeof op.insert === "string" && !Object.keys(op.attributes ?? {}).length);
  const normalized = legacyPlainText ? splitDeltaLines(rawOps) : rawOps;
  const ops: DeltaOp[] = legacyPlainText || (deltaData?.metadata ?? deltaData?.delta?.metadata)?.sourceFormat === "text"
    ? normalized : migrateLegacyMarkdownTables(normalized);

  const doc: JSONContent[] = [];
  let currentParagraph: JSONContent & { content: JSONContent[] } = { type: "paragraph", content: [] };
  let isImageBlock = false;
  // Quill 用紧随 embed 的换行标记块结束。它不是编辑器中的空段落，
  // 否则水平分割线在保存并重新加载后会凭空多出一行。
  let skipEmptyLineAfterBlockEmbed = false;
  /** 正在累积的列表行（未推入 doc，等待按 indent 重建树） */
  let pendingListLines: Array<{
    type: "bulletList" | "orderedList";
    indent: number;
    start?: number;
    taskChecked?: boolean;
    paragraph: JSONContent;
    continuation?: boolean;
    blockStart?: boolean;
  }> = [];

  function flushParagraph() {
    // 推入当前累积段落（含空段落——用户可能有意保留空行）
    doc.push({ ...currentParagraph });
    currentParagraph = { type: "paragraph", content: [] };
    isImageBlock = false;
  }

  /** 把连续的 Quill 列表行重建为 ProseMirror 嵌套列表树。 */
  function flushList() {
    if (pendingListLines.length === 0) return;

    // 外部 Delta 可能从非零 indent 开始或跨级缩进；规范化成相邻层级，
    // 既生成合法 schema，也不丢弃任何列表项。
    let previousIndent = 0;
    const normalized = pendingListLines.map((line, index) => {
      const indent = index === 0 ? 0 : Math.min(line.indent, previousIndent + 1);
      previousIndent = indent;
      return { ...line, indent };
    });

    let index = 0;
    const parseList = (depth: number, type: "bulletList" | "orderedList"): JSONContent => {
      const start = type === "orderedList"
        ? Math.max(1, Math.floor(Number(normalized[index]?.start) || 1))
        : undefined;
      const list = {
        type,
        ...(start !== undefined && start !== 1 ? { attrs: { start } } : {}),
        content: [] as JSONContent[],
      };

      const firstIndex = index;
      while (index < normalized.length) {
        const line = normalized[index];
        if (index > firstIndex && line.indent === depth && line.blockStart) break;
        if (line.indent < depth || line.indent === depth && line.type !== type) break;
        if (line.indent > depth) break;

        if (line.continuation && list.content.length) {
          const previous = list.content[list.content.length - 1];
          const tail = previous.content![previous.content!.length - 1];
          if (tail?.type === "blockquote" && line.paragraph.type === "blockquote") tail.content!.push(...(line.paragraph.content ?? []));
          else previous.content!.push(line.paragraph);
          index += 1;
          while (index < normalized.length && normalized[index].indent > depth) {
            const child = normalized[index];
            previous.content!.push(parseList(child.indent, child.type));
          }
          continue;
        }
        const item: JSONContent & { content: JSONContent[] } = {
          type: "listItem", content: [line.paragraph],
          ...(typeof line.taskChecked === "boolean" ? { attrs: { taskChecked: line.taskChecked } } : {}),
        };
        list.content.push(item);
        index += 1;

        while (index < normalized.length && normalized[index].indent > depth) {
          const child = normalized[index];
          item.content.push(parseList(child.indent, child.type));
        }
      }

      return list;
    };

    while (index < normalized.length) {
      const line = normalized[index];
      doc.push(parseList(line.indent, line.type));
    }

    pendingListLines = [];
  }

  for (const [index, op] of ops.entries()) {
    const insert = op.insert;
    const attrs = op.attributes ?? {};

    if (typeof insert === "string") {
      // 空代码块会携带空字符串；ProseMirror 不允许空 text 节点，否则
      // 整份 Markdown（而不只是该块）都会被 insertContent 拒绝。
      if (!insert) continue;
      const next = ops[index + 1];
      // 代码正文与块结束符分开存储。以换行开头的正文必须保留为
      // text，不能转换为 codeBlock schema 不允许的 hardBreak。
      // 单独的无格式换行仍是段落结束符（后面可能紧跟空代码块）。
      if (insert !== "\n" && next?.insert === "\n" && next.attributes?.["code-block"] && !Object.keys(attrs).length) {
        currentParagraph.content.push({ type: "text", text: insert });
        continue;
      }
      if (insert === "\n") {
        if (attrs["hard-break"] === true) {
          skipEmptyLineAfterBlockEmbed = false;
          currentParagraph.content.push({ type: "hardBreak" });
          continue;
        }
        if (
          skipEmptyLineAfterBlockEmbed &&
          currentParagraph.content.length === 0 &&
          Object.keys(attrs).length === 0
        ) {
          skipEmptyLineAfterBlockEmbed = false;
          continue;
        }
        skipEmptyLineAfterBlockEmbed = false;
        // ── 列表项 ──
        if (attrs.list === "bullet" || attrs.list === "ordered") {
          const rawIndent = Number(attrs.indent);
          pendingListLines.push({
            type: attrs.list === "bullet" ? "bulletList" : "orderedList",
            ...(typeof attrs.taskChecked === "boolean" ? { taskChecked: attrs.taskChecked } : {}),
            indent: Number.isFinite(rawIndent) ? Math.max(0, Math.floor(rawIndent)) : 0,
            ...(attrs.list === "ordered" && Number.isFinite(Number(attrs.listStart))
              ? { start: Math.max(1, Math.floor(Number(attrs.listStart))) }
              : {}),
            continuation: attrs["list-continuation"] === true,
            blockStart: attrs["list-block-start"] === true,
            paragraph: attrs["code-block"] ? {
              type: "codeBlock", content: currentParagraph.content,
              attrs: { language: attrs.language || null, title: attrs["code-title"] || "", wrap: attrs["code-wrap"] !== false, collapsed: attrs["code-collapsed"] === true },
            } : attrs.blockquote ? {
              type: "blockquote", attrs: { collapsed: attrs["blockquote-collapsed"] === true },
              content: [{ type: "paragraph", content: currentParagraph.content }],
            } : { type: "paragraph", content: currentParagraph.content },
          });
          currentParagraph = { type: "paragraph", content: [] };
          isImageBlock = false;
          continue;
        }

        // ── 非列表块级属性 → 先刷出 pendingList ──
        flushList();

        const blockIndent = Math.max(0, Math.min(8, Math.floor(Number(attrs.indent) || 0)));
        const blockIndentAttrs = blockIndent > 0 ? { indent: blockIndent } : {};

        if (attrs.header) {
          currentParagraph.type = "heading";
          currentParagraph.attrs = { level: attrs.header, ...blockIndentAttrs };
          flushParagraph();
        } else if (attrs["code-block"]) {
          currentParagraph.type = "codeBlock";
          const codeBlockAttrs = {
            ...blockIndentAttrs,
            ...(typeof attrs.language === "string" && attrs.language ? { language: attrs.language } : {}),
            ...(typeof attrs["code-title"] === "string" && attrs["code-title"]
              ? { title: attrs["code-title"] }
              : {}),
            ...(attrs["code-wrap"] === false ? { wrap: false } : {}),
            ...(attrs["code-collapsed"] === true ? { collapsed: true } : {}),
          };
          if (Object.keys(codeBlockAttrs).length > 0) currentParagraph.attrs = codeBlockAttrs;
          flushParagraph();
        } else if (attrs.blockquote) {
          // ProseMirror 的 blockquote schema 要求 content: "paragraph*"
          // 文本必须用 paragraph 包裹，不能直接放在 blockquote 下
          const quoteAttrs = blockIndent > 0 || attrs["blockquote-collapsed"] === true
            ? {
                ...blockIndentAttrs,
                ...(attrs["blockquote-collapsed"] === true ? { collapsed: true } : {}),
              }
            : undefined;
          const paragraph = { type: "paragraph", content: currentParagraph.content };
          const previous = doc[doc.length - 1];
          const sameQuote = previous?.type === "blockquote"
            && Math.max(0, Math.floor(Number(previous.attrs?.indent) || 0)) === blockIndent
            && Boolean(previous.attrs?.collapsed) === (attrs["blockquote-collapsed"] === true);
          if (sameQuote) {
            (previous.content ??= []).push(paragraph);
          } else {
            doc.push({
            type: "blockquote",
              ...(quoteAttrs ? { attrs: quoteAttrs } : {}),
              content: [paragraph],
            });
          }
          currentParagraph = { type: "paragraph", content: [] };
          isImageBlock = false;
        } else {
          if (blockIndent > 0) currentParagraph.attrs = blockIndentAttrs;
          flushParagraph();
        }
      } else if (insert.startsWith("\n")) {
        skipEmptyLineAfterBlockEmbed = false;
        flushList();
        // Hard break within paragraph
        currentParagraph.content.push({ type: "hardBreak" });
        const rest = insert.slice(1);
        if (rest) {
          const marks = deltaAttrToMarks(attrs);
          currentParagraph.content.push({ type: "text", text: rest, ...(marks.length > 0 ? { marks } : {}) });
        }
      } else {
        skipEmptyLineAfterBlockEmbed = false;
        const marks = deltaAttrToMarks(attrs);
        currentParagraph.content.push({
          type: "text",
          text: insert,
          ...(marks.length > 0 ? { marks } : {}),
        });
      }
    } else if (typeof insert === "object" && insert !== null) {
      flushList();
      const table = getTableEmbed(insert);
      if (table) {
        if (currentParagraph.content.length > 0 || isImageBlock) flushParagraph();
        doc.push(tableEmbedToProseMirror(table));
        currentParagraph = { type: "paragraph", content: [] };
        isImageBlock = false;
        skipEmptyLineAfterBlockEmbed = true;
        continue;
      }
      if (insert.image) {
        if (currentParagraph.content.length > 0 || isImageBlock) flushParagraph();
        doc.push({ type: "resizableImage", attrs: { src: insert.image }, content: [] });
        currentParagraph = { type: "paragraph", content: [] };
        isImageBlock = false;
        skipEmptyLineAfterBlockEmbed = true;
        continue;
      } else if (insert.hr) {
        // 分割线前若刚刚结束一个块，currentParagraph 会是空的；不能因此
        // 插入一个额外空段落。
        if (currentParagraph.content.length > 0 || isImageBlock) {
          flushParagraph();
        }
        doc.push({ type: "horizontalRule", content: [] });
        skipEmptyLineAfterBlockEmbed = true;
      }
    }
  }

  flushList();
  // 末尾不推入空段落：Delta 最后的 \n 是文档终止符，非有意空行
  if (currentParagraph.content.length > 0 || isImageBlock) {
    doc.push({ ...currentParagraph });
  }

  // ProseMirror/TipTap 需要至少一个可编辑的块节点。Chromium 通常会
  // 容错空 doc，但 Windows WebView2 可能无法为它生成可聚焦的文本区域。
  if (doc.length === 0) {
    doc.push({ type: "paragraph", content: [] });
  }

  return { type: "doc", content: doc };
}

/** 将旧版本保存成 `| ... |` 普通段落的表格安全升级为 table embed。 */
function migrateLegacyMarkdownTables(sourceOps: DeltaOp[]): DeltaOp[] {
  const result: DeltaOp[] = [];
  // 每个逻辑行只扫描一次。逐 op 调用 readLine 会反复拼接同一段的后缀，
  // 数万行内格式片段的长段落会退化成 O(N²)，即使其中根本没有表格。
  const lines: Array<{ text: string | null; from: number; to: number }> = [];
  let from = 0;
  let text = "";
  for (let index = 0; index < sourceOps.length; index++) {
    const op = sourceOps[index];
    if (typeof op.insert !== "string" || op.insert === "\n") {
      lines.push({
        text: op.insert === "\n" && !Object.keys(op.attributes ?? {}).length ? text : null,
        from, to: index + 1,
      });
      from = index + 1;
      text = "";
      continue;
    }
    const attrs = op.attributes ?? {};
    let part = op.insert;
    if (attrs.code) part = `\`${part}\``;
    if (attrs.bold) part = `**${part}**`;
    if (attrs.italic) part = `*${part}*`;
    if (attrs.link) part = `[${part}](${attrs.link})`;
    text += part;
  }
  if (from < sourceOps.length) lines.push({ text: null, from, to: sourceOps.length });

  let index = 0;
  while (index < lines.length) {
    const first = lines[index];
    const second = lines[index + 1];
    // 先验证表头和分隔行，避免连续的非表格 pipe 行被反复向后扫描。
    if (first.text?.trim().startsWith("|") && second?.text?.trim().startsWith("|")
      && markdownTableToEmbed([first.text, second.text])) {
      const tableLines = [first.text, second.text];
      let end = index + 2;
      while (end < lines.length && lines[end].text?.trim().startsWith("|")) {
        tableLines.push(lines[end].text!);
        end++;
      }
      const table = markdownTableToEmbed(tableLines)!;
      result.push({ insert: { table } }, { insert: "\n" });
      index = end;
      continue;
    }
    for (let opIndex = first.from; opIndex < first.to; opIndex++) result.push(sourceOps[opIndex]);
    index++;
  }
  return result;
}

function tableEmbedToProseMirror(table: TableEmbed): JSONContent {
  const columnCount = Math.max(
    1,
    table.columns.length,
    ...table.rows.map((row) => Array.isArray(row.cells) ? row.cells.length : 0),
  );
  const sourceRows = table.rows.length > 0 ? table.rows : [{ cells: [] }];
  const rows = sourceRows.map((row) => ({
    type: "tableRow",
    content: Array.from({ length: columnCount }, (_, column) => {
      const cell = row.cells?.[column];
      const ops = Array.isArray(cell?.content?.ops) ? cell.content.ops : [];
      const width = normalizeTableColumnWidth(table.columns[column]?.width);
      return {
        type: cell?.header ? "tableHeader" : "tableCell",
        attrs: {
          colspan: 1,
          rowspan: 1,
          colwidth: width ? [width] : null,
          textAlign: normalizeTableAlignment(table.columns[column]?.align),
        },
        content: [{ type: "paragraph", content: inlineDeltaToProseMirror(ops) }],
      };
    }),
  }));
  return { type: "table", content: rows };
}

function inlineDeltaToProseMirror(ops: DeltaOp[]): JSONContent[] {
  const content: JSONContent[] = [];
  for (const op of ops) {
    if (typeof op?.insert !== "string") continue;
    const marks = deltaAttrToMarks(op.attributes);
    const parts = op.insert.split("\n");
    parts.forEach((part: string, index: number) => {
      if (index > 0) content.push({ type: "hardBreak" });
      if (part) content.push({ type: "text", text: part, ...(marks.length > 0 ? { marks } : {}) });
    });
  }
  return content;
}

// ── 格式检测 ──

/** 判断一个 content 值是 ProseMirror 格式还是 Delta 格式 */
export function isProseMirror(content: unknown): content is JSONContent & { type: string; content: JSONContent[] } {
  if (!content || typeof content !== "object") return false;
  return "type" in content && content.type === "doc" && "content" in content && Array.isArray(content.content);
}

export function isDelta(content: unknown): boolean {
  if (!content || typeof content !== "object") return false;
  return "ops" in content && Array.isArray(content.ops)
    || "delta" in content && !!content.delta && typeof content.delta === "object"
      && "ops" in content.delta && Array.isArray(content.delta.ops);
}
