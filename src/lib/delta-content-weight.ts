import type { DeltaOp } from "../types/models";
import { getTableEmbed } from "./table-embed";

export const textWeight = (text: string) => text.replace(/\s/g, "").length;
export function deltaOpWeight(op: DeltaOp): number {
  if (typeof op.insert === "string") return textWeight(op.insert);
  if (!op.insert || typeof op.insert !== "object") return 1;
  const embed = op.insert as Record<string, unknown>;
  const sum = (value: unknown): number =>
    Array.isArray(value)
      ? (value as DeltaOp[]).reduce(
          (size, child) => size + deltaOpWeight(child),
          0,
        )
      : 0;
  if (embed.blockquote && typeof embed.blockquote === "object")
    return sum((embed.blockquote as { content?: unknown }).content);
  if (embed.list && typeof embed.list === "object")
    return (
      (embed.list as { items?: { content?: unknown }[] }).items ?? []
    ).reduce((size, item) => size + sum(item.content), 0);
  if (embed.htmlDetails && typeof embed.htmlDetails === "object")
    return sum((embed.htmlDetails as { content?: unknown }).content);
  if (Array.isArray(embed.footnotes))
    return (embed.footnotes as { content?: unknown }[]).reduce(
      (size, definition) => size + sum(definition.content),
      0,
    );
  const table = getTableEmbed(embed);
  return table
    ? Math.max(
        1,
        table.rows.reduce(
          (size, row) =>
            size +
            row.cells.reduce((size, cell) => size + sum(cell.content.ops), 0),
          0,
        ),
      )
    : 1;
}
