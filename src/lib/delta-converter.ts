/**
 * ProseMirror JSON ↔ Quill Delta JSON 双向转换
 *
 * Web 端 (TipTap) 用 ProseMirror 格式，
 * Flutter 端 (flutter_quill) 用 Quill Delta 格式。
 * 数据库 content 字段统一存 Quill Delta，
 * Web 端读写时做转换。
 */

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
function pmMarkToAttr(mark: any): Record<string, any> | null {
  switch (mark.type) {
    case "bold":      return { bold: true };
    case "italic":    return { italic: true };
    case "strike":    return { strike: true };
    case "code":      return { code: true };
    case "link":      return { link: mark.attrs?.href ?? "" };
    case "textStyle": {
      const attrs: Record<string, any> = {};
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
function deltaAttrToMarks(attrs: Record<string, any> | undefined): any[] {
  if (!attrs) return [];
  const marks: any[] = [];
  if (attrs.bold)      marks.push({ type: "bold" });
  if (attrs.italic)    marks.push({ type: "italic" });
  if (attrs.strike)    marks.push({ type: "strike" });
  if (attrs.code)      marks.push({ type: "code" });
  if (attrs.link)      marks.push({ type: "link", attrs: { href: attrs.link } });
  if (attrs.color)     marks.push({ type: "textStyle", attrs: { color: attrs.color } });
  if (attrs.size) {
    const px = namedToPx(attrs.size);
    marks.push({ type: "textStyle", attrs: { fontSize: String(px) } });
  }
  return marks;
}

// ── ProseMirror → Quill Delta ──

export function proseMirrorToDelta(pmJson: any): any {
  const ops: any[] = [];
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

function tableNodeToEmbed(tableNode: any): TableEmbed {
  const rows = (tableNode.content ?? []).map((row: any) => ({
    cells: (row.content ?? []).map((cell: any) => {
      const cellOps: any[] = [];
      const blocks = cell.content ?? [];
      blocks.forEach((block: any, index: number) => {
        if (index > 0) cellOps.push({ insert: "\n" });
        extractInlineOps(block, cellOps);
      });
      return {
        ...(cell.type === "tableHeader" ? { header: true } : {}),
        content: { ops: cellOps },
      };
    }),
  }));
  const columnCount = Math.max(0, ...rows.map((row: any) => row.cells.length));
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
function appendListOps(listNode: any, ops: any[], depth: number): void {
  const list = listNode.type === "orderedList" ? "ordered" : "bullet";
  const orderedStart = list === "ordered"
    ? Math.max(1, Math.floor(Number(listNode.attrs?.start) || 1))
    : undefined;

  for (const [itemIndex, item] of (listNode.content ?? []).entries()) {
    let emittedItemLine = false;
    const lineAttributes = {
      list,
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

      if (child.type === "paragraph") {
        extractInlineOps(child, ops);
        ops.push({
          insert: "\n",
          attributes: lineAttributes,
        });
        emittedItemLine = true;
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
  node: any,
  ops: any[],
  inheritAttrs?: Record<string, any>,
): void {
  const inlineContent = node.content ?? [];
  for (const inline of inlineContent) {
    if (inline.type === "text") {
      const attrs: Record<string, any> = { ...inheritAttrs };
      for (const mark of inline.marks ?? []) {
        const attr = pmMarkToAttr(mark);
        if (attr) Object.assign(attrs, attr);
      }
      ops.push({
        insert: inline.text,
        ...(Object.keys(attrs).length > 0 ? { attributes: attrs } : {}),
      });
    } else if (inline.type === "hardBreak") {
      ops.push({ insert: "\n" });
    } else if (inline.type === "image" || inline.type === "resizableImage") {
      ops.push({ insert: { image: inline.attrs?.src ?? "" } });
    } else if (inline.type === "paragraph" || inline.type === "listItem") {
      // 递归提取嵌套文本（如 listItem → paragraph → text）
      extractInlineOps(inline, ops, inheritAttrs);
    }
  }
}

// ── Quill Delta → ProseMirror ──

export function deltaToProseMirror(deltaData: any): any {
  // 兼容两种入参：{ops: [...]} 或 {delta: {ops: [...]}}
  const ops: any[] = migrateLegacyMarkdownTables(deltaData?.ops ?? deltaData?.delta?.ops ?? []);

  const doc: any[] = [];
  let currentParagraph: any = { type: "paragraph", content: [] };
  let isImageBlock = false;
  // Quill 用紧随 embed 的换行标记块结束。它不是编辑器中的空段落，
  // 否则水平分割线在保存并重新加载后会凭空多出一行。
  let skipEmptyLineAfterBlockEmbed = false;
  /** 正在累积的列表行（未推入 doc，等待按 indent 重建树） */
  let pendingListLines: Array<{
    type: "bulletList" | "orderedList";
    indent: number;
    start?: number;
    paragraph: any;
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
    const parseList = (depth: number, type: "bulletList" | "orderedList"): any => {
      const start = type === "orderedList"
        ? Math.max(1, Math.floor(Number(normalized[index]?.start) || 1))
        : undefined;
      const list = {
        type,
        ...(start !== undefined && start !== 1 ? { attrs: { start } } : {}),
        content: [] as any[],
      };

      while (index < normalized.length) {
        const line = normalized[index];
        if (line.indent < depth || line.indent === depth && line.type !== type) break;
        if (line.indent > depth) break;

        const item = { type: "listItem", content: [line.paragraph] };
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

  for (const op of ops) {
    const insert = op.insert;
    const attrs = op.attributes ?? {};

    if (typeof insert === "string") {
      if (insert === "\n") {
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
            indent: Number.isFinite(rawIndent) ? Math.max(0, Math.floor(rawIndent)) : 0,
            ...(attrs.list === "ordered" && Number.isFinite(Number(attrs.listStart))
              ? { start: Math.max(1, Math.floor(Number(attrs.listStart))) }
              : {}),
            paragraph: { type: "paragraph", content: currentParagraph.content },
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
            previous.content.push(paragraph);
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
function migrateLegacyMarkdownTables(sourceOps: any[]): any[] {
  const result: any[] = [];
  const readLine = (start: number): { text: string; end: number } | null => {
    let text = "";
    let index = start;
    for (; index < sourceOps.length; index++) {
      const op = sourceOps[index];
      if (typeof op?.insert !== "string") return null;
      if (op.insert === "\n") {
        if (Object.keys(op.attributes ?? {}).length > 0) return null;
        return { text, end: index + 1 };
      }
      const attrs = op.attributes ?? {};
      let part = op.insert;
      if (attrs.code) part = `\`${part}\``;
      if (attrs.bold) part = `**${part}**`;
      if (attrs.italic) part = `*${part}*`;
      if (attrs.link) part = `[${part}](${attrs.link})`;
      text += part;
    }
    return null;
  };

  let index = 0;
  while (index < sourceOps.length) {
    const first = readLine(index);
    if (first?.text.trim().startsWith("|")) {
      const lines = [first.text];
      let end = first.end;
      while (end < sourceOps.length) {
        const next = readLine(end);
        if (!next?.text.trim().startsWith("|")) break;
        lines.push(next.text);
        end = next.end;
      }
      const table = markdownTableToEmbed(lines);
      if (table) {
        result.push({ insert: { table } }, { insert: "\n" });
        index = end;
        continue;
      }
    }
    result.push(sourceOps[index]);
    index += 1;
  }
  return result;
}

function tableEmbedToProseMirror(table: TableEmbed): any {
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

function inlineDeltaToProseMirror(ops: any[]): any[] {
  const content: any[] = [];
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
export function isProseMirror(content: any): boolean {
  if (!content || typeof content !== "object") return false;
  return content.type === "doc" && Array.isArray(content.content);
}

export function isDelta(content: any): boolean {
  if (!content || typeof content !== "object") return false;
  return Array.isArray(content.ops) || content?.delta?.ops;
}
