import type { EditorState, Transaction } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { findSearchMatches } from "../extensions/SearchHighlights";

/** Literal, in-block replacement. Recompute matches from the current snapshot. */
export function createReplacementTransaction(state: EditorState, query: string, replacement: string, index?: number, caseSensitive = false): { transaction: Transaction; count: number; nextPosition: number } {
  const matches = findSearchMatches(state.doc, query, true, caseSensitive);
  const targets = index === undefined ? matches : matches.slice(index, index + 1);
  const transaction = closeHistory(state.tr);
  let count = 0;
  if (/[\r\n]/.test(replacement)) return { transaction, count, nextPosition: state.selection.from };
  for (const match of [...targets].reverse()) {
    if (state.doc.textBetween(match.from, match.to) === replacement) continue;
    // Keep the first matched character's inline style; surrounding text and
    // paragraph/list/table/code structure remain untouched.
    const marks = state.doc.resolve(match.from).nodeAfter?.marks ?? [];
    if (replacement) transaction.replaceWith(match.from, match.to, state.schema.text(replacement, marks));
    else transaction.delete(match.from, match.to);
    count++;
  }
  const last = targets[targets.length - 1];
  return { transaction, count, nextPosition: last ? transaction.mapping.map(last.to, 1) : state.selection.from };
}
