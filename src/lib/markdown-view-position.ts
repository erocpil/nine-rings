import type { JSONContent } from "@tiptap/core";
import type { DeltaOp, DeltaOps } from "../types/models";
import { mdToDelta, type MarkdownSourceSpan } from "./md-parser";
import { getTableEmbed } from "./table-embed";

const textWeight = (text: string) => text.replace(/\s/g, "").length;
function opWeight(op: DeltaOp): number {
  if (typeof op.insert === "string") return textWeight(op.insert);
  const table = getTableEmbed(op.insert);
  return table
    ? Math.max(
        1,
        table.rows.reduce(
          (sum, row) =>
            sum +
            row.cells.reduce(
              (sum, cell) =>
                sum +
                cell.content.ops.reduce((sum, op) => sum + opWeight(op), 0),
              0,
            ),
          0,
        ),
      )
    : 1;
}
export function nodeWeight(node: JSONContent): number {
  if (node.type === "text") return textWeight(node.text ?? "");
  if (["image", "resizableImage", "horizontalRule"].includes(node.type ?? ""))
    return 1;
  const weight = (node.content ?? []).reduce(
    (sum, child) => sum + nodeWeight(child),
    0,
  );
  return node.type === "table" ? Math.max(1, weight) : weight;
}
function nodeSize(node: JSONContent): number {
  if (node.type === "text") return node.text?.length ?? 0;
  if (
    ["image", "resizableImage", "horizontalRule", "hardBreak"].includes(
      node.type ?? "",
    )
  )
    return 1;
  return (
    2 + (node.content ?? []).reduce((sum, child) => sum + nodeSize(child), 0)
  );
}
export function renderedNodeText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(renderedNodeText).join("");
}
export function renderedPositionMap(doc: JSONContent) {
  let weight = 0,
    position = 0;
  return (doc.content ?? []).map((node, index) => {
    const entry = {
      index,
      position,
      from: weight,
      to: weight + nodeWeight(node),
    };
    weight = entry.to;
    position += nodeSize(node);
    return entry;
  });
}

export const renderedTextblockSelector = "p,h1,h2,h3,h4,h5,h6,pre";
/** Keep top-level identity for virtual rows, but locate individual list/quote/
 * table paragraphs instead of interpolating across an entire container. */
export function renderedTextblockMap(doc: JSONContent) {
  const entries: Array<{
    index: number;
    textblock: number | null;
    position: number;
    from: number;
    to: number;
    text: string;
  }> = [];
  let weight = 0;
  let position = 0;
  (doc.content ?? []).forEach((root, index) => {
    let textblock = 0;
    const visit = (node: JSONContent, pos: number) => {
      if (["paragraph", "heading", "codeBlock"].includes(node.type ?? "")) {
        const size = nodeWeight(node);
        entries.push({
          index,
          textblock: textblock++,
          position: pos,
          from: weight,
          to: weight + size,
          text: renderedNodeText(node),
        });
        weight += size;
      } else if (node.content?.length) {
        const before = weight;
        let childPos = pos + 1;
        for (const child of node.content) {
          visit(child, childPos);
          childPos += nodeSize(child);
        }
        if (node.type === "table" && weight === before) {
          weight++;
          entries[entries.length - 1].to = weight;
        }
      } else {
        const size = nodeWeight(node);
        entries.push({
          index,
          textblock: null,
          position: pos,
          from: weight,
          to: weight + size,
          text: renderedNodeText(node),
        });
        weight += size;
      }
    };
    visit(root, position);
    position += nodeSize(root);
  });
  return entries;
}
export function sourcePositionMap(source: string, parsed?: { delta: DeltaOps; spans: MarkdownSourceSpan[] }) {
  const spans: MarkdownSourceSpan[] = parsed?.spans ?? [];
  const delta = parsed?.delta ?? mdToDelta(source, spans);
  const lines = source.split(/\r\n|\r|\n/);
  const endings = [...source.matchAll(/\r\n|\r|\n/g)];
  const offsets = [
    0,
    ...endings.map((match) => match.index! + match[0].length),
  ];
  let weight = 0;
  return spans.flatMap((span) => {
    const from = offsets[span.fromLine] ?? source.length;
    const last = Math.max(span.fromLine, span.toLine - 1);
    const to = (offsets[last] ?? source.length) + (lines[last]?.length ?? 0);
    const ops = delta.ops.slice(span.fromOp, span.toOp);
    const table = ops.map((op) => getTableEmbed(op.insert)).find(Boolean);
    if (table) {
      const tableStart = weight;
      return table.rows.map((row, index) => {
        // Skip the separator row; it has syntax but no rendered text.
        const line = span.fromLine + (index === 0 ? 0 : index + 1);
        const from = offsets[line] ?? source.length;
        let size = row.cells.reduce(
          (sum, cell) =>
            sum + cell.content.ops.reduce((sum, op) => sum + opWeight(op), 0),
          0,
        );
        if (
          index === table.rows.length - 1 &&
          weight === tableStart &&
          size === 0
        )
          size = 1;
        const entry = {
          from,
          to: from + (lines[line]?.length ?? 0),
          weightFrom: weight,
          weightTo: weight + size,
        };
        weight += size;
        return entry;
      });
    }
    const size = ops.reduce((sum, op) => sum + opWeight(op), 0);
    const entry = { from, to, weightFrom: weight, weightTo: weight + size };
    weight += size;
    return [entry];
  });
}
const fraction = (value: number, from: number, to: number) =>
  Math.max(0, Math.min(1, (value - from) / Math.max(1, to - from)));
export function sourceOffsetToWeight(
  source: string,
  offset: number,
  map = sourcePositionMap(source),
): number {
  const entry = map.find((item) => item.to >= offset) ?? map[map.length - 1];
  return entry
    ? entry.weightFrom +
        fraction(offset, entry.from, entry.to) *
          (entry.weightTo - entry.weightFrom)
    : 0;
}
export function weightToSourceOffset(
  source: string,
  weight: number,
  map = sourcePositionMap(source),
): number {
  const entry =
    map.find((item) => item.weightTo > weight) ?? map[map.length - 1];
  return entry
    ? Math.round(
        entry.from +
          fraction(weight, entry.weightFrom, entry.weightTo) *
            (entry.to - entry.from),
      )
    : 0;
}

/** Measure actual textarea wrapping without changing focus, caret or selection. */
export function textareaPosition(
  area: HTMLTextAreaElement,
  offset?: number,
): number {
  const mirror = document.createElement("div");
  const style = getComputedStyle(area);
  for (const name of [
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "tab-size",
    "padding",
    "direction",
  ])
    mirror.style.setProperty(name, style.getPropertyValue(name));
  Object.assign(mirror.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${area.clientWidth}px`,
    boxSizing: "border-box",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    visibility: "hidden",
  });
  const text = document.createTextNode(area.value + "\u200b");
  mirror.append(text);
  document.body.append(mirror);
  try {
    const top = mirror.getBoundingClientRect().top;
    const range = document.createRange();
    const at = (index: number) => {
      range.setStart(text, Math.max(0, Math.min(area.value.length, index)));
      range.setEnd(text, Math.min(text.length, range.startOffset + 1));
      return range.getBoundingClientRect();
    };
    const padding = parseFloat(style.paddingTop) || 0;
    if (offset !== undefined)
      return Math.max(0, at(offset).top - top - padding);
    let low = 0,
      high = area.value.length;
    const target = area.scrollTop + padding;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (at(mid).bottom - top <= target + 1) low = mid + 1;
      else high = mid;
    }
    return low;
  } finally {
    mirror.remove();
  }
}
