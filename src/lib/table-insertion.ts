import type { Editor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";
import { addColumn, addRow, CellSelection, isInTable, selectedRect, selectionCell, TableMap } from "@tiptap/pm/tables";

export function insertTableAxis(editor: Editor, axis: "row" | "column", side: "before" | "after", tablePosition?: number): void {
  if (editor.isDestroyed || !editor.isEditable) return;
  const { state, view } = editor;
  const current = isInTable(state) ? selectedRect(state) : null;
  const table = tablePosition === undefined ? current?.table : state.doc.nodeAt(tablePosition);
  if (!table || table.type.spec.tableRole !== "table") return;
  const tableStart = tablePosition === undefined ? current?.tableStart : tablePosition + 1;
  if (tableStart === undefined) return;
  const map = TableMap.get(table);
  const row = axis === "row";
  const withinTable = current?.tableStart === tableStart;
  const bounds = tablePosition === undefined && current
    ? current : { table, tableStart, map, left: 0, top: 0, right: map.width, bottom: map.height };
  const start = row ? bounds.top : bounds.left;
  const end = row ? bounds.bottom : bounds.right;
  const index = side === "before" ? start : end;
  const head = withinTable ? (state.selection instanceof CellSelection ? state.selection.$headCell : selectionCell(state)) : null;
  const anchor = head ? map.findCell(head.pos - tableStart) : null;
  const preferred = anchor ? (row ? anchor.left : anchor.top) : 0;
  const tr = (row ? addRow : addColumn)(state.tr, bounds, index);
  const updatedTable = tr.doc.nodeAt(tableStart - 1)!;
  const updated = TableMap.get(updatedTable);
  let nearest = Infinity;
  let targetCell: number | undefined;
  const length = row ? updated.width : updated.height;
  for (let offset = 0; offset < length; offset++) {
    const distance = Math.abs(offset - preferred);
    if (distance >= nearest) continue;
    const slot = row ? index * updated.width + offset : offset * updated.width + index;
    const cell = updated.map[slot];
    // A spanning cell that covers both this slot and the preceding strip is old.
    if (index > 0 && updated.map[slot - (row ? updated.width : 1)] === cell) continue;
    targetCell = cell;
    nearest = distance;
    if (distance === 0) break;
  }
  if (targetCell !== undefined) {
    const from = tableStart + targetCell;
    const selection = Selection.findFrom(tr.doc.resolve(from + 1), 1, true);
    if (selection && selection.from < from + updatedTable.nodeAt(targetCell)!.nodeSize) tr.setSelection(selection);
  }
  view.dispatch(tr.scrollIntoView());
  view.focus();
}
