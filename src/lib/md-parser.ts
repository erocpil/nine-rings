/**
 * md-parser.ts — Markdown → Quill Delta 转换器
 *
 * 支持的语法： # ## ### 标题  **粗体**  *斜体*  `行内代码`
 *            ``` 代码块    - 无序列表   1. 有序列表（含多级混合列表）
 *            > 引用        [链接](url)  --- 分割线
 */

interface DeltaOp {
  insert: string | { hr: true } | { image: string } | { table: import("./table-embed").TableEmbed };
  attributes?: Record<string, unknown>;
}

interface DeltaOps {
  ops: DeltaOp[];
}

/** 保守判断纯文本是否很可能是 Markdown。 */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const fenced = lines.filter((line) => /^\s*```/.test(line)).length;
  if (fenced >= 2) return true;

  for (let index = 0; index + 1 < lines.length; index++) {
    if (isMarkdownTableRow(lines[index]) && isMarkdownTableSeparator(lines[index + 1])) return true;
  }

  if (lines.length === 1 && /^\s*#{1,6}\s+\S/.test(lines[0])) return true;

  let blockSignals = 0;
  for (const line of lines) {
    if (/^\s*#{1,6}\s+\S/.test(line)) blockSignals++;
    else if (/^\s*>\s+\S/.test(line)) blockSignals++;
    else if (/^\s*[-*+]\s+\S/.test(line)) blockSignals++;
    else if (/^\s*\d+\.\s+\S/.test(line)) blockSignals++;
    else if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) blockSignals++;
  }
  if (blockSignals >= 2) return true;

  const inlineSignal = /\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)/.test(text);
  return blockSignals >= 1 && inlineSignal;
}

// ── 行内解析 ──

interface InlineSegment {
  insert: string | { image: string };
  attrs: Record<string, unknown>;
}

function findInlineEnd(text: string, marker: string, from: number): number {
  for (let end = text.indexOf(marker, from); end !== -1; end = text.indexOf(marker, end + marker.length)) {
    let slashes = 0;
    for (let before = end - 1; before >= 0 && text[before] === "\\"; before--) slashes++;
    if (slashes % 2 === 0) return end;
  }
  return -1;
}

// 大段 Markdown 可能产生数万片段；push(...items) 会触发 WebView 的参数栈限制。
function appendItems<T>(target: T[], items: readonly T[]): void {
  for (const item of items) target.push(item);
}

function parseInline(text: string): InlineSegment[] {
  const result: InlineSegment[] = [];
  let i = 0;

  while (i < text.length) {
    // CommonMark escapes consume exactly one backslash before ASCII punctuation.
    // Do this before matching syntax; code spans below keep their raw contents.
    const nextCode = text.charCodeAt(i + 1);
    if (text[i] === "\\" && (nextCode >= 33 && nextCode <= 47
      || nextCode >= 58 && nextCode <= 64 || nextCode >= 91 && nextCode <= 96
      || nextCode >= 123 && nextCode <= 126)) {
      result.push({ insert: text[i + 1], attrs: {} });
      i += 2;
      continue;
    }
    // ![替代文字](图片地址)
    const imageMatch = text.slice(i).match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imageMatch) {
      result.push({ insert: { image: imageMatch[2] }, attrs: {} });
      i += imageMatch[0].length;
      continue;
    }

    // [链接](url)
    const linkMatch = text.slice(i).match(/^\[((?:\\.|[^\]\\])+)\]\(([^)]+)\)/);
    if (linkMatch) {
      appendItems(result, parseInline(linkMatch[1]).map(segment => ({ ...segment, attrs: { ...segment.attrs, link: linkMatch[2] } })));
      i += linkMatch[0].length;
      continue;
    }

    // **粗体**
    if (text.slice(i, i + 2) === "**") {
      const j = findInlineEnd(text, "**", i + 2);
      if (j !== -1) {
        appendItems(result, parseInline(text.slice(i + 2, j)).map(segment => ({ ...segment, attrs: { ...segment.attrs, bold: true } })));
        i = j + 2;
        continue;
      }
    }

    // *斜体* (单星号)
    if (text[i] === "*" && (i + 1 >= text.length || text[i + 1] !== "*")) {
      const j = findInlineEnd(text, "*", i + 1);
      if (j !== -1) {
        const inner = text.slice(i + 1, j);
        if (inner) {
          appendItems(result, parseInline(inner).map(segment => ({ ...segment, attrs: { ...segment.attrs, italic: true } })));
          i = j + 1;
          continue;
        }
      }
    }

    if (text.slice(i, i + 2) === "~~") {
      const end = findInlineEnd(text, "~~", i + 2);
      if (end !== -1) {
        appendItems(result, parseInline(text.slice(i + 2, end)).map(segment => ({ ...segment, attrs: { ...segment.attrs, strike: true } })));
        i = end + 2;
        continue;
      }
    }

    // `行内代码`
    if (text[i] === "`") {
      const marker = text.slice(i).match(/^`+/)![0];
      let j = text.indexOf(marker, i + marker.length);
      while (j !== -1 && (text[j - 1] === "`" || text[j + marker.length] === "`")) {
        j = text.indexOf(marker, j + marker.length);
      }
      if (j !== -1) {
        let value = text.slice(i + marker.length, j);
        if (value.startsWith(" ") && value.endsWith(" ") && /[^ ]/.test(value)) value = value.slice(1, -1);
        result.push({ insert: value, attrs: { code: true } });
        i = j + marker.length;
        continue;
      }
    }

    // 连续普通文本作为一个片段处理，避免长文档逐字符创建对象、合并属性。
    // 未匹配的语法起始符仍消费一个字符，再从下一个可能的起始符重试。
    const start = i++;
    while (i < text.length && text[i] !== "!" && text[i] !== "["
      && text[i] !== "*" && text[i] !== "`" && text[i] !== "\\" && text[i] !== "~") i++;
    result.push({ insert: text.slice(start, i), attrs: {} });
  }

  return result;
}

function inlineToDelta(text: string, baseAttrs?: Record<string, unknown>): DeltaOp[] {
  if (!text) return [];

  const segments = parseInline(text);
  const merged: Array<{ insert: string | { image: string }; attrs: Record<string, unknown> }> = [];

  for (const seg of segments) {
    if (typeof seg.insert !== "string") {
      merged.push(seg);
      continue;
    }
    const combined: Record<string, unknown> = { ...(baseAttrs || {}) };
    for (const [k, v] of Object.entries(seg.attrs)) {
      if (v) combined[k] = v;
    }
    // Filter out empty values
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(combined)) {
      if (v !== null && v !== undefined && v !== false && v !== "") clean[k] = v;
    }

    const last = merged[merged.length - 1];
    if (last && typeof last.insert === "string" && JSON.stringify(last.attrs) === JSON.stringify(clean)) {
      last.insert += seg.insert;
    } else {
      merged.push({ insert: seg.insert, attrs: clean });
    }
  }

  return merged.map((m) => {
    const op: DeltaOp = { insert: m.insert };
    if (Object.keys(m.attrs).length > 0) op.attributes = m.attrs;
    return op;
  });
}

export function isMarkdownTableRow(text: string): boolean {
  return /^\s*\|(?:[^|\n]*\|){2,}\s*$/.test(text);
}

function isMarkdownTableSeparator(text: string): boolean {
  return /^\s*\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|\s*$/.test(text);
}

function splitMarkdownTableRow(source: string): string[] {
  let row = source.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);

  const cells: string[] = [];
  let current = "";
  let escaped = false;
  let codeFenceLength = 0;
  for (let index = 0; index < row.length; index++) {
    const char = row[index];
    if (escaped) {
      current += char === "|" ? "|" : `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "`") {
      let run = 1;
      while (row[index + run] === "`") run++;
      if (codeFenceLength === 0) codeFenceLength = run;
      else if (codeFenceLength === run) codeFenceLength = 0;
      current += "`".repeat(run);
      index += run - 1;
      continue;
    }
    if (char === "|" && codeFenceLength === 0) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (escaped) current += "\\";
  cells.push(current.trim());
  return cells;
}

function separatorAlignment(cell: string): import("./table-embed").TableAlignment {
  const value = cell.trim();
  if (!/^:?-{3,}:?$/.test(value)) return null;
  if (value.startsWith(":") && value.endsWith(":")) return "center";
  if (value.endsWith(":")) return "right";
  return "left";
}

/** Parse a complete GFM table (header, separator, and optional data rows). */
export function markdownTableToEmbed(tableLines: string[]): import("./table-embed").TableEmbed | null {
  if (tableLines.length < 2 || !isMarkdownTableRow(tableLines[0]) || !isMarkdownTableSeparator(tableLines[1])) {
    return null;
  }
  const headerCells = splitMarkdownTableRow(tableLines[0]);
  const separatorCells = splitMarkdownTableRow(tableLines[1]);
  const columnCount = Math.max(headerCells.length, separatorCells.length);
  const makeRow = (cells: string[], header: boolean): import("./table-embed").TableRowEmbed => ({
    cells: Array.from({ length: columnCount }, (_, column) => ({
      ...(header ? { header: true } : {}),
      content: { ops: inlineToDelta(cells[column] ?? "") },
    })),
  });
  return {
    version: 1,
    columns: Array.from({ length: columnCount }, (_, column) => ({
      align: separatorAlignment(separatorCells[column] ?? ""),
    })),
    rows: [
      makeRow(headerCells, true),
      ...tableLines.slice(2).filter(isMarkdownTableRow).map((line) => makeRow(splitMarkdownTableRow(line), false)),
    ],
  };
}

// ── 全文解析 ──

export interface MarkdownSourceSpan { fromLine: number; toLine: number; fromOp: number; toOp: number }

export function mdToDelta(mdText: string, sourceSpans?: MarkdownSourceSpan[]): DeltaOps {
  // Windows/WebView2 剪贴板使用 CRLF。若保留行尾的 `\r`，依赖 `$` 的
  // 块级正则（尤其列表）会匹配失败，缩进列表继而退化成以 `-` 开头的段落。
  const lines = mdText.replace(/\r\n?/g, "\n").split("\n");
  const ops: DeltaOp[] = [];
  let i = 0;
  let inCode = false;
  let codeBuf: string[] = [];
  let codeLanguage = "";
  let codeFence = "";
  let codeStartLine = 0;
  let listIndentStack: number[] = [];

  const resetListIndent = () => {
    listIndentStack = [];
  };

  /** 将 Markdown 的 2/4 空格或 Tab 缩进映射为连续的 Quill indent。 */
  const resolveListDepth = (whitespace: string): number => {
    const columns = [...whitespace].reduce((sum, char) => sum + (char === "\t" ? 4 : 1), 0);
    if (listIndentStack.length === 0) {
      listIndentStack.push(columns);
      return 0;
    }

    while (listIndentStack.length > 1 && columns < listIndentStack[listIndentStack.length - 1]) {
      listIndentStack.pop();
    }
    if (columns > listIndentStack[listIndentStack.length - 1]) {
      listIndentStack.push(columns);
    }
    return Math.max(0, listIndentStack.indexOf(columns) >= 0
      ? listIndentStack.indexOf(columns)
      : listIndentStack.length - 1);
  };

  const isTableStart = (lineIndex: number): boolean =>
    isMarkdownTableRow(lines[lineIndex] ?? "") && isMarkdownTableSeparator(lines[lineIndex + 1] ?? "");

  // 知识文档常用 `**概念**`、`**原理**` 充当无编号的小标题。CommonMark
  // 会把它和紧随其后的非空行视为同一段软换行，但在编辑器里这会显示成
  // “概念DPDK...”。整行只有加粗内容时按独立标签段处理。
  const isStandaloneBoldLabel = (text: string): boolean =>
    /^\*\*[^*\n]+\*\*[：:]?\s*$/.test(text);

  // Markdown 的单个换行是段落内的软换行，而不是新的段落。这里列出会
  // 终止当前段落的块级语法；其余连续非空行会在下面合并为同一段。
  const startsBlock = (text: string): boolean =>
    /^(?:`{3,}|~{3,})/.test(text) ||
    /^[-*_]{3,}\s*$/.test(text) ||
    /^(#{1,6})\s+.+$/.test(text) ||
    /^>\s?(.*)$/.test(text) ||
    /^[-*+]\s+.+$/.test(text) ||
    /^\d+\.\s+.+$/.test(text) ||
    isStandaloneBoldLabel(text) ||
    isMarkdownTableRow(text);

  const appendParagraph = (paragraphLines: string[]) => {
    appendItems(ops, inlineToDelta(paragraphLines.join(" ")));
    ops.push({ insert: "\n" });
  };

  while (i < lines.length) {
    const fromLine = inCode ? codeStartLine : i;
    const fromOp = ops.length;
    try {
    const line = lines[i];
    const stripped = line.trim();

    // ── 代码块 ──
    const fence = stripped.match(/^(`{3,}|~{3,})(.*)$/);
    if (fence && (!inCode || (fence[1][0] === codeFence[0] && fence[1].length >= codeFence.length && !fence[2].trim()))) {
      resetListIndent();
      if (inCode) {
        ops.push({ insert: codeBuf.join("\n") });
        ops.push({
          insert: "\n",
          attributes: { "code-block": true, ...(codeLanguage ? { language: codeLanguage } : {}) },
        });
        codeBuf = [];
        codeLanguage = "";
        inCode = false;
      } else {
        codeFence = fence[1];
        codeStartLine = i;
        codeLanguage = fence[2].trim().split(/\s/)[0];
        inCode = true;
      }
      i++;
      continue;
    }

    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    // ── 空行 ──
    if (!stripped) {
      const previousInsert = ops[ops.length - 1]?.insert;
      if (typeof previousInsert === "string" && !previousInsert.endsWith("\n")) {
        ops.push({ insert: "\n" });
      }
      i++;
      continue;
    }

    // ── Markdown 表格 ──
    // 保持表头、分隔行和每个数据行各自独立，避免换行被普通段落折叠。
    if (isTableStart(i)) {
      resetListIndent();
      const tableLines = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && isMarkdownTableRow(lines[i])) tableLines.push(lines[i++]);
      const table = markdownTableToEmbed(tableLines);
      if (table) ops.push({ insert: { table } });
      ops.push({ insert: "\n" });
      continue;
    }

    // ── 分割线 ──
    if (/^[-*_]{3,}\s*$/.test(stripped)) {
      resetListIndent();
      ops.push({ insert: { hr: true } });
      i++;
      continue;
    }

    // ── 标题 ──
    const hMatch = stripped.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      resetListIndent();
      const level = hMatch[1].length;
      const text = hMatch[2];
      appendItems(ops, inlineToDelta(text));
      ops.push({ insert: "\n", attributes: { header: level } });
      i++;
      continue;
    }

    // ── 引用 ──
    const bqMatch = stripped.match(/^>\s?(.*)$/);
    if (bqMatch) {
      resetListIndent();
      const paragraphLines = [bqMatch[1].trim()];
      i++;

      // 引用块允许“懒续行”：后续文字即使没有再次写 `>`，仍属于同一个
      // 引用段落。这是聊天工具复制的 Markdown 常见形式。
      while (i < lines.length) {
        const continuation = lines[i].trim();
        if (!continuation || startsBlock(continuation)) break;
        paragraphLines.push(continuation);
        i++;
      }

      appendItems(ops, inlineToDelta(paragraphLines.join(" ")));
      ops.push({ insert: "\n", attributes: { blockquote: true } });
      continue;
    }

    // ── 列表（保留前导空白对应的嵌套深度）──
    const listMatch = line.match(/^([ \t]*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const depth = resolveListDepth(listMatch[1]);
      const list = /^\d/.test(listMatch[2]) ? "ordered" : "bullet";
      const listStart = list === "ordered" ? Number.parseInt(listMatch[2], 10) : undefined;
      const task = /^\[([ xX])\](?:[ \t]+(.*)|$)/.exec(listMatch[3]);
      appendItems(ops, inlineToDelta(task ? task[2] ?? "" : listMatch[3]));
      i++;

      // 列表项的 lazy continuation（以及显式缩进的续行）仍属于当前项。
      // 编辑器以 hardBreak 保留 Markdown 源文件的行结构，使粘贴后的第二行
      // 与首行正文对齐，而不是掉回列表外侧或被误建成新列表项。
      while (i < lines.length) {
        const continuation = lines[i].trim();
        if (!continuation || startsBlock(continuation)) break;
        const continuationOps = inlineToDelta(continuation);
        const [first, ...rest] = continuationOps;
        if (first && typeof first.insert === "string") {
          ops.push({ ...first, insert: `\n${first.insert}` });
          appendItems(ops, rest);
        }
        i++;
      }

      ops.push({
        insert: "\n",
        attributes: {
          list,
          ...(task ? { taskChecked: task[1].toLowerCase() === "x" } : {}),
          ...(depth > 0 ? { indent: depth } : {}),
          ...(listStart !== undefined ? { listStart } : {}),
        },
      });
      continue;
    }

    // ── 独立加粗标签 ──
    // 与下一行正文分成两个段落，避免视觉上直接拼接。
    if (isStandaloneBoldLabel(stripped)) {
      resetListIndent();
      appendParagraph([stripped]);
      i++;
      continue;
    }

    // ── 普通段落 ──
    resetListIndent();
    const paragraphLines = [stripped];
    i++;
    while (i < lines.length) {
      const continuation = lines[i].trim();
      if (!continuation || startsBlock(continuation)) break;
      paragraphLines.push(continuation);
      i++;
    }
    appendParagraph(paragraphLines);
    } finally {
      if (sourceSpans && ops.length > fromOp) sourceSpans.push({ fromLine, toLine: i, fromOp, toOp: ops.length });
    }
  }

  // 关闭未闭合的代码块
  if (inCode && codeBuf.length > 0) {
    const fromOp = ops.length;
    ops.push({ insert: codeBuf.join("\n") });
    ops.push({
      insert: "\n",
      attributes: { "code-block": true, ...(codeLanguage ? { language: codeLanguage } : {}) },
    });
    sourceSpans?.push({ fromLine: codeStartLine, toLine: lines.length, fromOp, toOp: ops.length });
  }

  return { ops };
}

/** 从 markdown 提取第一个 # 标题，fallback 到文件名 */
export function extractTitle(mdText: string, fallback: string): string {
  const m = mdText.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}
