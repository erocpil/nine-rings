import { describe, expect, it } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import {
  formatSourceLines,
  insertSourceBlock,
} from "../../src/lib/source-editing";

describe("source toolbar editing", () => {
  it("converts selected lists without losing text, preserves blank/adjacent lines, and undoes once", () => {
    let state = EditorState.create({
      doc: "before\n- first\n\n2. second\nafter",
      selection: EditorSelection.range(7, 26),
      extensions: [history()],
    });
    state = state.update(formatSourceLines(state, "task")!).state;
    expect(state.doc.toString()).toBe(
      "before\n- [ ] first\n\n- [ ] second\nafter",
    );
    undo({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    });
    expect(state.doc.toString()).toBe("before\n- first\n\n2. second\nafter");
  });
  it("toggles quote prefixes and ignores a final line outside the selection", () => {
    const state = EditorState.create({
      doc: "> one\n  > two\nthree",
      selection: EditorSelection.range(0, 14),
    });
    const next = state.update(formatSourceLines(state, "quote")!).state;
    expect(next.doc.toString()).toBe("one\n  two\nthree");
  });
  it("uses a longer fence for selected backticks and keeps surrounding paragraphs", () => {
    const text = "before\n\n```js\nx\n```\n\nafter";
    const state = EditorState.create({
      doc: text,
      selection: EditorSelection.range(8, 19),
    });
    const next = state.update(insertSourceBlock(state, "code")!).state;
    expect(next.doc.toString()).toBe(
      "before\n\n````\n```js\nx\n```\n````\n\nafter",
    );
    expect(
      next.sliceDoc(next.selection.main.from, next.selection.main.to),
    ).toBe("```js\nx\n```");
  });
  it("does not allow toolbar mutations on a readonly state", () => {
    const state = EditorState.create({
      doc: "protected",
      extensions: EditorState.readOnly.of(true),
    });
    expect(formatSourceLines(state, "task")).toBeNull();
    expect(insertSourceBlock(state, "table")).toBeNull();
  });
  it("preserves selected text when inserting a table or separator", () => {
    for (const kind of ["table", "rule"] as const) {
      const state = EditorState.create({
        doc: "keep this text",
        selection: EditorSelection.range(0, 14),
      });
      const next = state.update(insertSourceBlock(state, kind)!).state;
      expect(next.doc.toString()).toContain("\n\nkeep this text\n");
    }
  });
  it("converts a checked task to an ordinary list without leaving a checkbox", () => {
    const state = EditorState.create({ doc: "- [x] finished" });
    const next = state.update(formatSourceLines(state, "bullet")!).state;
    expect(next.doc.toString()).toBe("- finished");
  });
});
