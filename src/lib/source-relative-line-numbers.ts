import { gutter, GutterMarker } from "@codemirror/view";
import { foldedRanges } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import {
  foldedNumberRanges,
  relativeFoldedLineNumber,
  type FoldedNumberRange,
} from "./relative-numbering";

const indexes = new WeakMap<
  EditorState["doc"],
  WeakMap<object, FoldedNumberRange[]>
>();
function foldedIndex(state: EditorState) {
  const folds = foldedRanges(state);
  let byFolds = indexes.get(state.doc);
  if (!byFolds) {
    byFolds = new WeakMap();
    indexes.set(state.doc, byFolds);
  }
  let index = byFolds.get(folds);
  if (!index) {
    const ranges: Array<[number, number]> = [];
    folds.between(0, state.doc.length, (from, to) => {
      ranges.push([
        state.doc.lineAt(from).number + 1,
        state.doc.lineAt(to).number,
      ]);
    });
    index = foldedNumberRanges(ranges);
    byFolds.set(folds, index);
  }
  return index;
}

class NumberMarker extends GutterMarker {
  constructor(readonly number: string) {
    super();
  }
  eq(other: NumberMarker) {
    return this.number === other.number;
  }
  toDOM() {
    return document.createTextNode(this.number);
  }
}

/** The standard formatNumber hook does not refresh on selection changes.
 * Use the same gutter class and viewport rendering with an explicit trigger. */
export function relativeLineNumbers() {
  return gutter({
    class: "cm-lineNumbers",
    lineMarker(view, line) {
      const number = view.state.doc.lineAt(line.from).number;
      const current = view.state.doc.lineAt(
        view.state.selection.main.head,
      ).number;
      return new NumberMarker(
        String(
          relativeFoldedLineNumber(number, current, foldedIndex(view.state)),
        ),
      );
    },
    lineMarkerChange: (update) =>
      update.selectionSet ||
      update.docChanged ||
      foldedRanges(update.startState) !== foldedRanges(update.state),
    initialSpacer: (view) =>
      new NumberMarker("9".repeat(String(view.state.doc.lines).length)),
    updateSpacer(spacer, update) {
      const number = "9".repeat(String(update.state.doc.lines).length);
      return (spacer as NumberMarker).number === number
        ? spacer
        : new NumberMarker(number);
    },
  });
}
