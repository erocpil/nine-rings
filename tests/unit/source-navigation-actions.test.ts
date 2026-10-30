import { describe, expect, it } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { cpp } from "@codemirror/lang-cpp";
import { history, undo } from "@codemirror/commands";
import {
  sourceNavigationExtension,
  setSourceMark,
  sourceMarks,
  jumpSourceMark,
  selectSourceObject,
  repeatSourceEdit,
} from "../../src/lib/source-navigation-actions";
import { jumpSourceStructure } from "../../src/lib/source-structural-navigation";
function editor(doc: string, anchor = 0, readonly = false) {
  let state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      cpp(),
      sourceNavigationExtension,
      history(),
      EditorState.readOnly.of(readonly),
    ],
  });
  return {
    get state() {
      return state;
    },
    composing: false,
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
}
describe("source navigation actions", () => {
  it("maps named marks through edits without changing content on jump", () => {
    const view = editor("int x;", 4);
    expect(setSourceMark(view, "here")).toBe(true);
    view.dispatch({ changes: { from: 0, insert: "// comment\n" } });
    expect(sourceMarks(view)).toEqual([["here", 15]]);
    expect(jumpSourceMark(view, "here")).toBe(true);
    expect(view.state.selection.main.head).toBe(15);
    expect(setSourceMark(view, "bad name")).toBe(false);
  });
  it("selects bracket, string and function objects in readonly code", () => {
    const source = 'int f() { call("abc"); }';
    const view = editor(source, source.indexOf("abc") + 1, true);
    expect(selectSourceObject(view, "quote")).toBe(true);
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe("abc");
    expect(selectSourceObject(view, "brackets")).toBe(true);
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe('"abc"');
    expect(selectSourceObject(view, "function")).toBe(true);
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe(source);
  });
  it("repeats a simple insertion as one undoable action and rejects readonly", () => {
    const view = editor("ab", 1);
    view.dispatch({
      changes: { from: 1, insert: "X" },
      selection: { anchor: 2 },
      userEvent: "input.type",
    });
    expect(repeatSourceEdit(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("aXXb");
    undo(view);
    expect(view.state.doc.toString()).toBe("aXb");
    expect(repeatSourceEdit(editor("ab", 0, true))).toBe(false);
  });
  it("navigates indentation levels", () => {
    const view = editor("void f() {\n  if (x) {\n    run();\n  }\n}", 28);
    expect(jumpSourceStructure(view, -1, true)).toBe(true);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(
      2,
    );
  });
});
