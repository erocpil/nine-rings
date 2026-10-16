import { isTableEmbed } from "../table-embed";
import { normalizeEditorColor } from "../editor-color";

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));

/** Strict candidate boundary; the editor's tolerant legacy loader is not certification. */
export function isCertifiedTable(
  value: unknown,
  inline: (ops: unknown) => boolean,
): boolean {
  if (
    !record(value) ||
    !keys(value, ["version", "columns", "rows"]) ||
    !isTableEmbed(value) ||
    !value.columns.length ||
    !value.rows.length
  )
    return false;
  if (
    !value.columns.every(
      (column) => record(column) && keys(column, ["align", "width"]),
    )
  )
    return false;
  return value.rows.every(
    (row) =>
      record(row) &&
      keys(row, ["cells"]) &&
      row.cells.every((cell) => {
        if (
          !record(cell) ||
          !keys(cell, [
            "header",
            "colspan",
            "rowspan",
            "background",
            "content",
            "paragraphs",
          ])
        )
          return false;
        if (cell.header !== undefined && cell.header !== true) return false;
        if (cell.colspan !== undefined && cell.colspan <= 1) return false;
        if (cell.rowspan !== undefined && cell.rowspan <= 1) return false;
        if (
          cell.background !== undefined &&
          normalizeEditorColor(cell.background) !== cell.background
        )
          return false;
        const body = (v: unknown) =>
          record(v) && keys(v, ["ops"]) && inline(v.ops);
        return (
          body(cell.content) &&
          (cell.paragraphs === undefined ||
            (cell.paragraphs.length > 1 && cell.paragraphs.every(body)))
        );
      }),
  );
}
