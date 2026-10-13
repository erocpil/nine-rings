import { normalizeEditorColor } from "./editor-color";
import type { DeltaOps } from "../types/models";

export type TableAlignment = "left" | "center" | "right" | null;

export interface TableCellEmbed {
  header?: boolean;
  colspan?: number;
  rowspan?: number;
  background?: string;
  paragraphs?: DeltaOps[];
  content: DeltaOps;
}

export interface TableRowEmbed {
  cells: TableCellEmbed[];
}

export interface TableEmbed {
  version: 1;
  columns: Array<{ align: TableAlignment; width?: number }>;
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
  )
    return false;
  return (
    table.columns.every((column) => {
      if (!column || typeof column !== "object") return false;
      const candidate = column as { align?: unknown; width?: unknown };
      return (
        normalizeTableAlignment(candidate.align) === candidate.align &&
        (candidate.width === undefined ||
          normalizeTableColumnWidth(candidate.width) === candidate.width)
      );
    }) &&
    table.rows.every(
      (row) =>
        !!row &&
        typeof row === "object" &&
        Array.isArray((row as TableRowEmbed).cells) &&
        (row as TableRowEmbed).cells.length <= 100 &&
        (row as TableRowEmbed).cells.every(
          (cell) =>
            !!cell &&
            typeof cell === "object" &&
            Array.isArray(cell.content?.ops) &&
            (cell.colspan === undefined ||
              (Number.isInteger(cell.colspan) &&
                cell.colspan >= 1 &&
                cell.colspan <= 100)) &&
            (cell.rowspan === undefined ||
              (Number.isInteger(cell.rowspan) &&
                cell.rowspan >= 1 &&
                cell.rowspan <= table.rows!.length)) &&
            (cell.background === undefined ||
              normalizeEditorColor(cell.background) !== null) &&
            (cell.paragraphs === undefined ||
              (Array.isArray(cell.paragraphs) &&
                cell.paragraphs.length > 0 &&
                cell.paragraphs.every((paragraph) =>
                  Array.isArray(paragraph?.ops),
                ))),
        ),
    ) &&
    validTableSpans(table as TableEmbed)
  );
}

export function getTableEmbed(insert: unknown): TableEmbed | null {
  if (!insert || typeof insert !== "object") return null;
  const table = (insert as { table?: unknown }).table;
  return isTableEmbed(table) ? table : null;
}

export function normalizeTableAlignment(value: unknown): TableAlignment {
  return value === "left" || value === "center" || value === "right"
    ? value
    : null;
}

export function normalizeTableColumnWidth(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 25 &&
    value <= 10_000
    ? value
    : null;
}

export function hasTableSpans(table: TableEmbed): boolean {
  return table.rows.some((row) =>
    row.cells.some(
      (cell) => (cell.colspan ?? 1) > 1 || (cell.rowspan ?? 1) > 1,
    ),
  );
}
/** Sparse cells occupy the first available column; covered slots are not duplicated. */
export function tableCellColumns(table: TableEmbed): number[][] {
  const coveredUntil: number[] = [];
  return table.rows.map((row, rowIndex) => {
    let column = 0;
    return row.cells.map((cell) => {
      while ((coveredUntil[column] ?? 0) > rowIndex) column++;
      const start = column;
      for (let offset = 0; offset < (cell.colspan ?? 1); offset++)
        coveredUntil[column++] = rowIndex + (cell.rowspan ?? 1);
      return start;
    });
  });
}
function validTableSpans(table: TableEmbed): boolean {
  if (!hasTableSpans(table)) return true; // Legacy ragged tables retain their padding behavior.
  const coveredUntil: number[] = [];
  for (let row = 0; row < table.rows.length; row++) {
    let column = 0;
    for (const cell of table.rows[row].cells) {
      while ((coveredUntil[column] ?? 0) > row) column++;
      const colspan = cell.colspan ?? 1,
        rowspan = cell.rowspan ?? 1;
      if (
        column + colspan > table.columns.length ||
        row + rowspan > table.rows.length
      )
        return false;
      for (let offset = 0; offset < colspan; offset++) {
        if ((coveredUntil[column] ?? 0) > row) return false;
        coveredUntil[column++] = row + rowspan;
      }
    }
    if (
      Array.from(
        { length: table.columns.length },
        (_, column) => (coveredUntil[column] ?? 0) > row,
      ).some((value) => !value)
    )
      return false;
  }
  return true;
}
