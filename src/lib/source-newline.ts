import { countColumn } from "@codemirror/state";
import type { StateCommand, ChangeSpec } from "@codemirror/state";
import { insertNewlineAndIndent } from "@codemirror/commands";

/** Keep manual indentation when a language's top-level/default rule returns
 * zero. Preserve native bracket expansion and meaningful dedentation. */
export const insertSourceNewline: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  return insertNewlineAndIndent({
    state,
    dispatch: (transaction) => {
      const adjustments: ChangeSpec[] = [];
      transaction.changes.iterChanges((from, _to, start, _end, inserted) => {
        // Matched brackets insert two newlines; leave their language layout intact.
        if (
          inserted.lines !== 2 ||
          inserted.line(1).text !== "" ||
          !/^[\t ]*$/.test(inserted.line(2).text)
        )
          return;
        const line = state.doc.lineAt(from);
        const prefix = /^[\t ]*/.exec(line.text)![0];
        const proposed = inserted.line(2).text;
        if (!prefix || /^[\t ]*[}\])]/.test(line.text)) return;
        if (
          countColumn(proposed, state.tabSize) >
          countColumn(prefix, state.tabSize)
        )
          return;
        if (prefix !== proposed)
          adjustments.push({
            from: start + 1,
            to: start + inserted.length,
            insert: prefix,
          });
      });
      if (!adjustments.length) {
        dispatch(transaction);
        return;
      }
      const correction = transaction.state.changes(adjustments);
      dispatch(
        state.update({
          changes: transaction.changes.compose(correction),
          selection: transaction.newSelection.map(correction, 1),
          scrollIntoView: true,
          userEvent: "input",
        }),
      );
    },
  });
};
