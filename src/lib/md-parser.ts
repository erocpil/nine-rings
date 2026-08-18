/**
 * md-parser.ts — Markdown → Quill Delta 转换器
 *
 * 支持的语法： # ## ### 标题  **粗体**  *斜体*  `行内代码`
 *            ``` 代码块    - 无序列表   1. 有序列表
 *            > 引用        [链接](url)  --- 分割线
 */

interface DeltaOp {
  insert: string | { hr: true };
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
  text: string;
  attrs: Record<string, unknown>;
}

function parseInline(text: string): InlineSegment[] {
  const result: InlineSegment[] = [];
  let i = 0;

  while (i < text.length) {
    // [链接](url)
    const linkMatch = text.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      result.push({ text: linkMatch[1], attrs: { link: linkMatch[2] } });
      i += linkMatch[0].length;
      continue;
    }

    // **粗体**
    if (text.slice(i, i + 2) === "**") {
      const j = text.indexOf("**", i + 2);
      if (j !== -1) {
        result.push({ text: text.slice(i + 2, j), attrs: { bold: true } });
        i = j + 2;
        continue;
      }
    }

    // *斜体* (单星号)
    if (text[i] === "*" && (i + 1 >= text.length || text[i + 1] !== "*")) {
      const j = text.indexOf("*", i + 1);
      if (j !== -1) {
        const inner = text.slice(i + 1, j);
        if (inner) {
          result.push({ text: inner, attrs: { italic: true } });
          i = j + 1;
          continue;
        }
      }
    }

    // `行内代码`
    if (text[i] === "`") {
      const j = text.indexOf("`", i + 1);
      if (j !== -1) {
        result.push({ text: text.slice(i + 1, j), attrs: { code: true } });
        i = j + 1;
        continue;
      }
    }

    // 普通字符
    result.push({ text: text[i], attrs: {} });
    i++;
  }

  return result;
}

function inlineToDelta(text: string, baseAttrs?: Record<string, unknown>): DeltaOp[] {
  if (!text) return [];

  const segments = parseInline(text);
  const merged: { text: string; attrs: Record<string, unknown> }[] = [];

  for (const seg of segments) {
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
    if (last && JSON.stringify(last.attrs) === JSON.stringify(clean)) {
      last.text += seg.text;
    } else {
      merged.push({ text: seg.text, attrs: clean });
    }
  }

  return merged.map((m) => {
    const op: DeltaOp = { insert: m.text };
    if (Object.keys(m.attrs).length > 0) op.attributes = m.attrs;
    return op;
  });
}

// ── 全文解析 ──

export function mdToDelta(mdText: string): DeltaOps {
  const lines = mdText.split("\n");
  const ops: DeltaOp[] = [];
  let i = 0;
  let inCode = false;
  let codeBuf: string[] = [];

  // 当前编辑器 schema 没有 table 节点。Markdown 表格先保留为逐行的
  // `| … |` 段落，既避免被折叠成一行，也可在粘贴/导出时保持结构。
  const isTableRow = (text: string): boolean => /^\s*\|(?:[^|\n]*\|){2,}\s*$/.test(text);
  const isTableSeparator = (text: string): boolean =>
    /^\s*\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|\s*$/.test(text);
  const isTableStart = (lineIndex: number): boolean =>
    isTableRow(lines[lineIndex] ?? "") && isTableSeparator(lines[lineIndex + 1] ?? "");

  // Markdown 的单个换行是段落内的软换行，而不是新的段落。这里列出会
  // 终止当前段落的块级语法；其余连续非空行会在下面合并为同一段。
  const startsBlock = (text: string): boolean =>
    /^```/.test(text) ||
    /^[-*_]{3,}\s*$/.test(text) ||
    /^(#{1,6})\s+.+$/.test(text) ||
    /^>\s?(.*)$/.test(text) ||
    /^[-*+]\s+.+$/.test(text) ||
    /^\d+\.\s+.+$/.test(text) ||
    isTableRow(text);

  const appendParagraph = (paragraphLines: string[]) => {
    ops.push(...inlineToDelta(paragraphLines.join(" ")));
    ops.push({ insert: "\n" });
  };

  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trim();

    // ── 代码块 ──
    if (/^```/.test(stripped)) {
      if (inCode) {
        if (codeBuf.length > 0) {
          ops.push({ insert: codeBuf.join("\n") });
          ops.push({ insert: "\n", attributes: { "code-block": true } });
        }
        codeBuf = [];
        inCode = false;
      } else {
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
      while (i < lines.length && isTableRow(lines[i])) {
        appendParagraph([lines[i].trim()]);
        i++;
      }
      continue;
    }

    // ── 分割线 ──
    if (/^[-*_]{3,}\s*$/.test(stripped)) {
      ops.push({ insert: { hr: true } });
      i++;
      continue;
    }

    // ── 标题 ──
    const hMatch = stripped.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const text = hMatch[2];
      ops.push(...inlineToDelta(text));
      ops.push({ insert: "\n", attributes: { header: level } });
      i++;
      continue;
    }

    // ── 引用 ──
    const bqMatch = stripped.match(/^>\s?(.*)$/);
    if (bqMatch) {
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

      ops.push(...inlineToDelta(paragraphLines.join(" ")));
      ops.push({ insert: "\n", attributes: { blockquote: true } });
      continue;
    }

    // ── 无序列表 ──
    const blMatch = stripped.match(/^[-*+]\s+(.+)$/);
    if (blMatch) {
      ops.push(...inlineToDelta(blMatch[1]));
      ops.push({ insert: "\n", attributes: { list: "bullet" } });
      i++;
      continue;
    }

    // ── 有序列表 ──
    const olMatch = stripped.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      ops.push(...inlineToDelta(olMatch[1]));
      ops.push({ insert: "\n", attributes: { list: "ordered" } });
      i++;
      continue;
    }

    // ── 普通段落 ──
    const paragraphLines = [stripped];
    i++;
    while (i < lines.length) {
      const continuation = lines[i].trim();
      if (!continuation || startsBlock(continuation)) break;
      paragraphLines.push(continuation);
      i++;
    }
    appendParagraph(paragraphLines);
  }

  // 关闭未闭合的代码块
  if (inCode && codeBuf.length > 0) {
    ops.push({ insert: codeBuf.join("\n") });
    ops.push({ insert: "\n", attributes: { "code-block": true } });
  }

  return { ops };
}

/** 从 markdown 提取第一个 # 标题，fallback 到文件名 */
export function extractTitle(mdText: string, fallback: string): string {
  const m = mdText.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}
