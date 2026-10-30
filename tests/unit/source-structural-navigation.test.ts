import { describe, expect, it } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { cpp } from "@codemirror/lang-cpp";
import { expandSourceSelection, shrinkSourceSelection, jumpSourceWord } from "../../src/lib/source-structural-navigation";

function editor(source: string, position: number) {
  let state = EditorState.create({ doc: source, selection: { anchor: position }, extensions: [cpp(), EditorState.readOnly.of(true)] });
  return { get state() { return state; }, composing: false, dispatch: (spec: TransactionSpec) => { state = state.update(spec).state; } } as unknown as EditorView;
}
describe("source structural navigation", () => {
  it("expands and restores selection in readonly source without changing text", () => {
    const view = editor("void f() { call(value); }", 17);
    const original = view.state.selection;
    expect(expandSourceSelection(view)).toBe(true);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("value");
    expect(expandSourceSelection(view)).toBe(true);
    expect(shrinkSourceSelection(view)).toBe(true);
    expect(shrinkSourceSelection(view)).toBe(true);
    expect(view.state.selection.eq(original)).toBe(true);
    expect(view.state.doc.toString()).toBe("void f() { call(value); }");
  });
  it("jumps whole words, wraps and leaves unmatched words in place", () => {
    const view = editor("item items item", 0);
    expect(jumpSourceWord(view, 1)).toBe(true);
    expect(view.state.selection.main.head).toBe(11);
    expect(jumpSourceWord(view, 1)).toBe(true);
    expect(view.state.selection.main.head).toBe(0);
    expect(jumpSourceWord(view, -1)).toBe(true);
    expect(view.state.selection.main.head).toBe(11);
    expect(jumpSourceWord(editor("single", 0), 1)).toBe(false);
  });
});
