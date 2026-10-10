import type { EditorState, StateEffect } from "@codemirror/state";
import {
  ensureSyntaxTree,
  foldable,
  foldedRanges,
  foldEffect,
  unfoldEffect,
} from "@codemirror/language";

/** Use Markdown syntax and native section ranges, excluding headings in fenced code. */
export function sourceHeadingFoldEffects(
  state: EditorState,
  level: number,
  collapse: boolean,
): StateEffect<unknown>[] | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 200);
  if (!tree) return null;
  const effects: StateEffect<unknown>[] = [];
  tree.iterate({
    enter(node) {
      const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (!match) return;
      const depth = Number(match[1]);
      const line = state.doc.lineAt(node.to);
      const range = foldable(state, state.doc.lineAt(node.from).from, line.to);
      if (!range) return;
      if (collapse || depth <= level) {
        foldedRanges(state).between(range.from, range.from, (from, to) => {
          if (from === range.from && to === range.to)
            effects.push(unfoldEffect.of(range));
        });
      }
      if (collapse ? depth >= level : depth > level) effects.push(foldEffect.of(range));
    },
  });
  return effects;
}
