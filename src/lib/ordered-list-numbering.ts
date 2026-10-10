import type { EditorState, Transaction } from "@tiptap/pm/state";
import { canSplit } from "@tiptap/pm/transform";
import { closeHistory } from "@tiptap/pm/history";

export const MAX_LIST_START = 999_999_999;
export function validListStart(start: number): boolean {
  return Number.isInteger(start) && start >= 1 && start <= MAX_LIST_START;
}

/** Search siblings only: a nested list must never continue an outer list. */
export function orderedListNumbering(state: EditorState) {
  const { $from, to } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== "orderedList") continue;
    const position = $from.before(depth);
    if (to > position + node.nodeSize - 1) return null;
    const parent = $from.node(depth - 1);
    let continuation: number | null = null;
    for (let index = $from.index(depth - 1) - 1; index >= 0; index--) {
      const previous = parent.child(index);
      if (
        previous.type.name !== "orderedList" ||
        Number(previous.attrs.indent ?? 0) !== Number(node.attrs.indent ?? 0)
      )
        continue;
      const next = Number(previous.attrs.start ?? 1) + previous.childCount;
      if (validListStart(next) && validListStart(next + node.childCount - 1))
        continuation = next;
      break;
    }
    return { node, position, itemIndex: $from.index(depth), continuation };
  }
  return null;
}

/** Splitting at a child boundary keeps position maps and reference anchors intact. */
export function renumberOrderedList(
  state: EditorState,
  start: number,
  splitCurrentItem = true,
): Transaction | null {
  if (!validListStart(start)) return null;
  const current = orderedListNumbering(state);
  if (!current) return null;
  const { node, position, itemIndex } = current;
  const count = node.childCount - (splitCurrentItem ? itemIndex : 0);
  if (!validListStart(start + count - 1)) return null;
  const transaction = state.tr;
  if (splitCurrentItem && itemIndex > 0) {
    let boundary = position + 1;
    for (let index = 0; index < itemIndex; index++)
      boundary += node.child(index).nodeSize;
    const after = [{ type: node.type, attrs: { ...node.attrs, start } }];
    if (!canSplit(state.doc, boundary, 1, after)) return null;
    transaction.split(boundary, 1, after);
  } else {
    if (Number(node.attrs.start ?? 1) === start) return null;
    transaction.setNodeMarkup(position, undefined, { ...node.attrs, start });
  }
  return closeHistory(transaction).scrollIntoView();
}
