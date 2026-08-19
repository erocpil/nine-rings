import type { DeltaOp, DeltaOps } from "../types/models";
import { getTableEmbed, type TableEmbed } from "./table-embed";

type BlockKind = "paragraph" | "list" | "table" | "code" | "quote" | "heading" | "embed";

function escapeMarkdownText(text: string, inTable: boolean): string {
  let escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/[*_[\]]/g, "\\$&");
  if (inTable) escaped = escaped.replace(/\|/g, "\\|");
  return escaped;
}

function wrapCode(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${text}${fence}`;
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
    if (attrs["code-block"]) {
      const language = typeof attrs.language === "string" ? attrs.language : "";
      push("code", `\`\`\`${language}\n${raw}\n\`\`\``);
      raw = "";
      return;
    }
    raw = "";
    if (typeof attrs.header === "number") {
      push("heading", `${"#".repeat(Math.min(6, Math.max(1, attrs.header)))} ${value}`);
      return;
    }
    if (attrs.list === "bullet" || attrs.list === "ordered") {
      const indent = typeof attrs.indent === "number" ? Math.max(0, Math.floor(attrs.indent)) : 0;
      push("list", `${"  ".repeat(indent)}${attrs.list === "bullet" ? "-" : "1."} ${value}`);
      return;
    }
    if (attrs.blockquote) {
      push("quote", `> ${value}`);
      return;
    }
    push("paragraph", value);
  };

  for (const op of ops) {
    if (typeof op.insert === "string") {
      if (op.insert === "\n") flushLine(op.attributes ?? {});
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
      markdown += block.kind === "list" && previous.kind === "list" ? "\n" : "\n\n";
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
