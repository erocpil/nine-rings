import type { DeltaOps } from "../types/models";

export type TableAlignment = "left" | "center" | "right" | null;

export interface TableCellEmbed {
  header?: boolean;
  content: DeltaOps;
}

export interface TableRowEmbed {
  cells: TableCellEmbed[];
}

export interface TableEmbed {
  version: 1;
  columns: Array<{ align: TableAlignment }>;
  rows: TableRowEmbed[];
}

export interface TableInsert {
  table: TableEmbed;
}

export function isTableEmbed(value: unknown): value is TableEmbed {
  if (!value || typeof value !== "object") return false;
  const table = value as Partial<TableEmbed>;
  if (
    table.version !== 1 ||
    !Array.isArray(table.columns) ||
    !Array.isArray(table.rows) ||
    table.columns.length > 100 ||
    table.rows.length > 10_000
  ) return false;
  return table.columns.every((column) =>
    !!column && typeof column === "object" &&
    normalizeTableAlignment((column as { align?: unknown }).align) === (column as { align?: unknown }).align,
  ) && table.rows.every((row) =>
    !!row && typeof row === "object" && Array.isArray((row as TableRowEmbed).cells) &&
    (row as TableRowEmbed).cells.length <= 100 &&
    (row as TableRowEmbed).cells.every((cell) =>
      !!cell && typeof cell === "object" && Array.isArray(cell.content?.ops),
    ),
  );
}

export function getTableEmbed(insert: unknown): TableEmbed | null {
  if (!insert || typeof insert !== "object") return null;
  const table = (insert as { table?: unknown }).table;
  return isTableEmbed(table) ? table : null;
}

export function normalizeTableAlignment(value: unknown): TableAlignment {
  return value === "left" || value === "center" || value === "right" ? value : null;
}
