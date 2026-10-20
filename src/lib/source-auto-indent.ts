import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, indentRange, language } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";

export type SourceAutoIndentScope = "selection" | "document";

/** Reindent selected lines (or the whole document) with the active language's
 * CodeMirror indentation rules. Changes are isolated as one undoable action. */
export function sourceAutoIndentChange(
  state: EditorState,
  scope: SourceAutoIndentScope,
): TransactionSpec | null {
  if (state.readOnly || !state.doc.length) return null;

  const activeLanguage = state.facet(language);
  if (activeLanguage && !ensureSyntaxTree(state, state.doc.length, 1000)) {
    throw Error("源码仍在解析，请稍后重试自动缩进。");
  }

  const selectedLines = new Set<number>();
  if (scope === "document") {
    for (let line = 1; line <= state.doc.lines; line++) selectedLines.add(line);
  } else {
    const selectedRanges = state.selection.ranges.filter(range => !range.empty);
    if (!selectedRanges.length) return null;
    for (const range of selectedRanges) {
      const first = state.doc.lineAt(range.from).number;
      const last = state.doc.lineAt(Math.max(range.from, range.to - 1)).number;
      for (let line = first; line <= last; line++) selectedLines.add(line);
    }
  }

  if (!selectedLines.size) return null;
  const ordered = [...selectedLines].sort((a, b) => a - b);
  const changes: { from: number; to: number; insert: string }[] = [];
  let start = ordered[0];
  let end = start;
  const collect = (first: number, last: number) => {
    const changeSet = indentRange(
      state,
      state.doc.line(first).from,
      state.doc.line(last).to,
    );
    changeSet.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      changes.push({ from: _fromA, to: _toA, insert: inserted.toString() });
    });
  };
  for (const line of ordered.slice(1)) {
    if (line === end + 1) {
      end = line;
      continue;
    }
    collect(start, end);
    start = end = line;
  }
  collect(start, end);

  return changes.length
    ? {
        changes,
        userEvent: "input.indent",
        annotations: isolateHistory.of("full"),
      }
    : null;
}
