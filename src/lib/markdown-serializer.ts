import type { DeltaOp, DeltaOps } from "../types/models";
import { getTableEmbed, type TableEmbed } from "./table-embed";

type BlockKind = "paragraph" | "list" | "table" | "code" | "quote" | "heading" | "embed";

function escapeMarkdownText(text: string, inTable: boolean): string {
  let escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/[*_[\]`~]/g, "\\$&");
  if (inTable) escaped = escaped.replace(/\|/g, "\\|");
  return escaped;
}

function wrapCode(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") || (text.startsWith(" ") && text.endsWith(" ") && /[^ ]/.test(text)) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function inlineOpToMarkdown(op: DeltaOp, inTable = false): string {
  if (typeof op.insert !== "string") return "";
  const attrs = op.attributes ?? {};
  if (attrs.code) return wrapCode(inTable ? op.insert.replace(/\|/g, "\\|") : op.insert);

  let text = escapeMarkdownText(op.insert, inTable);
  if (attrs.bold) text = `**${text}**`;
  if (attrs.italic) text = `*${text}*`;
  if (attrs.strike) text = `~~${text}~~`;
  if (typeof attrs.link === "string" && attrs.link) text = `[${text}](${attrs.link})`;
  return text;
}

function inlineDeltaToMarkdown(content: DeltaOps, inTable = false): string {
  return (content.ops ?? [])
    .map((op) => typeof op.insert === "string" && op.insert === "\n"
      ? (inTable ? "<br>" : "\n")
      : inlineOpToMarkdown(op, inTable))
    .join("");
}

function tableToMarkdown(table: TableEmbed): string {
  const columnCount = Math.max(
    1,
    table.columns.length,
    ...table.rows.map((row) => row.cells?.length ?? 0),
  );
  const sourceRows = table.rows.length > 0 ? table.rows : [{ cells: [] }];
  const hasHeader = sourceRows[0].cells.some((cell) => cell?.header);
  const header = hasHeader ? sourceRows[0] : { cells: [] };
  const body = hasHeader ? sourceRows.slice(1) : sourceRows;
  const renderRow = (row: (typeof sourceRows)[number]) => `| ${Array.from(
    { length: columnCount },
    (_, column) => inlineDeltaToMarkdown(row.cells[column]?.content ?? { ops: [] }, true),
  ).join(" | ")} |`;
  const separator = `| ${Array.from({ length: columnCount }, (_, column) => {
    switch (table.columns[column]?.align) {
      case "center": return ":---:";
      case "right": return "---:";
      case "left": return ":---";
      default: return "---";
    }
  }).join(" | ")} |`;
  return [renderRow(header), separator, ...body.map(renderRow)].join("\n");
}

/** 将应用的 Delta（含版本化 table embed）序列化为规范化 Markdown。 */
export function deltaToMarkdown(content: unknown): string {
  const candidate = content as { ops?: DeltaOp[] } | null;
  const ops = Array.isArray(candidate?.ops)
    ? candidate.ops
    : Array.isArray(content) ? content as DeltaOp[] : [];
  const blocks: Array<{ kind: BlockKind; value: string }> = [];
  let inline = "";
  let raw = "";

  const push = (kind: BlockKind, value: string) => {
    blocks.push({ kind, value });
  };
  const flushLine = (attrs: Record<string, unknown> = {}) => {
    const value = inline;
    inline = "";
    const continuation = attrs["list-continuation"] === true && (attrs.list === "ordered" || attrs.list === "bullet");
    const continuationPrefix = " ".repeat(2 * Math.max(0, Math.floor(Number(attrs.indent) || 0))
      + (attrs.list === "ordered" ? `${Math.max(1, Number(attrs.listStart) || 1)}. `.length : 2));
    const pushContinuation = (text: string) => push("list", "\n" + text.split("\n").map(line => continuationPrefix + line).join("\n"));
    if (attrs["code-block"]) {
      const language = typeof attrs.language === "string" ? attrs.language : "";
      const fence = "`".repeat((raw.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length + 1), 3));
      const code = `${fence}${language}\n${raw}\n${fence}`;
      if (continuation) pushContinuation(code);
      else push("code", code);
      raw = "";
      return;
    }
    raw = "";
    if (continuation) {
      pushContinuation(attrs.blockquote ? `> ${value}` : value);
      return;
    }
    if (typeof attrs.header === "number") {
      push("heading", `${"#".repeat(Math.min(6, Math.max(1, attrs.header)))} ${value}`);
      return;
    }
    if (attrs.list === "bullet" || attrs.list === "ordered") {
      const indent = typeof attrs.indent === "number" ? Math.max(0, Math.floor(attrs.indent)) : 0;
      const orderedStart = Number(attrs.listStart);
      const marker = attrs.list === "bullet"
        ? "-"
        : `${Number.isFinite(orderedStart) && orderedStart >= 1 ? Math.floor(orderedStart) : 1}.`;
      const task =
        typeof attrs.taskChecked === "boolean"
          ? `[${attrs.taskChecked ? "x" : " "}]${value ? " " : ""}`
          : "";
      push("list", `${"  ".repeat(indent)}${marker} ${task}${value}`);
      return;
    }
    if (attrs.blockquote) {
      push("quote", `> ${value}`);
      return;
    }
    // Plain rich-editor text must not turn into block syntax on the next parse.
    push("paragraph", value
      .replace(/^(\s*)(?=>|#(?:\s|#)|[+-]\s|-{3,})/, "$1\\")
      .replace(/^(\s*\d+)\.(?=\s)/, "$1\\."));
  };

  for (const op of ops) {
    if (typeof op.insert === "string") {
      if (op.insert === "\n" && op.attributes?.["hard-break"] === true) {
        inline += "  \n";
      } else if (op.insert === "\n") flushLine(op.attributes ?? {});
      else {
        inline += inlineOpToMarkdown(op);
        raw += op.insert;
      }
      continue;
    }

    if (inline) flushLine();
    const table = getTableEmbed(op.insert);
    if (table) {
      push("table", tableToMarkdown(table));
      continue;
    }
    const insert = op.insert as Record<string, unknown>;
    if (insert.hr) push("embed", "---");
    else {
      const image = typeof insert.image === "string"
        ? insert.image
        : (insert.resizableImage as { src?: unknown } | undefined)?.src;
      if (typeof image === "string") push("embed", `![](${image})`);
    }
  }
  if (inline) flushLine();

  let markdown = "";
  blocks.forEach((block, index) => {
    if (index > 0) {
      const previous = blocks[index - 1];
      const sameCompactContainer = block.kind === previous.kind
        && (block.kind === "list" || block.kind === "quote");
      markdown += sameCompactContainer ? "\n" : "\n\n";
    }
    markdown += block.value;
  });
  return markdown.trim();
}

/** 笔记级 Markdown：正文已有同名 H1 时不重复注入标题。 */
export function noteToMarkdown(title: string | null | undefined, content: unknown): string {
  const normalizedTitle = title?.trim() || "无标题";
  const body = deltaToMarkdown(content);
  const heading = `# ${normalizedTitle}`;
  if (body === heading || body.startsWith(`${heading}\n`)) return body;
  return body ? `${heading}\n\n${body}` : heading;
}
