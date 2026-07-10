/**
 * md-parser.ts — Markdown → Quill Delta 转换器
 *
 * 支持的语法： # ## ### 标题  **粗体**  *斜体*  `行内代码`
 *            ``` 代码块    - 无序列表   1. 有序列表
 *            > 引用        [链接](url)  --- 分割线
 */

interface DeltaOp {
  insert: string;
  attributes?: Record<string, unknown>;
}

interface DeltaOps {
  ops: DeltaOp[];
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
      if (ops.length > 0 && !ops[ops.length - 1].insert.endsWith("\n")) {
        ops.push({ insert: "\n" });
      }
      i++;
      continue;
    }

    // ── 分割线 ──
    if (/^[-*_]{3,}\s*$/.test(stripped)) {
      ops.push({ insert: "─".repeat(8), attributes: { strike: true } });
      ops.push({ insert: "\n" });
      i++;
      continue;
    }

    // ── 标题 ──
    const hMatch = stripped.match(/^(#{1,3})\s+(.+)$/);
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
      ops.push(...inlineToDelta(bqMatch[1]));
      ops.push({ insert: "\n", attributes: { blockquote: true } });
      i++;
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
    ops.push(...inlineToDelta(line));
    ops.push({ insert: "\n" });
    i++;
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
