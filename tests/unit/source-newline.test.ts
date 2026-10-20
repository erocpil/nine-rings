import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { history, undo } from "@codemirror/commands";
import { insertSourceNewline } from "../../src/lib/source-newline";

function enter(text: string, language = cpp(), cursor = text.length) {
  let state = EditorState.create({
    doc: text,
    selection: { anchor: cursor },
    extensions: [language, history()],
  });
  insertSourceNewline({
    state,
    dispatch: (tr) => {
      state = tr.state;
    },
  });
  return state;
}
describe("source newline", () => {
  it("inherits manual spaces and exact tabs in C/C++", () => {
    for (const prefix of ["    ", "\t", "\t  "]) {
      const state = enter(prefix + "int n = 1;");
      expect(state.doc.toString()).toBe(prefix + "int n = 1;\n" + prefix);
      expect(state.selection.main.head).toBe(state.doc.length);
    }
  });
  it("keeps native bracket expansion and Python block indentation", () => {
    const brackets = enter("int main() {}", cpp(), 12).doc.toString();
    expect(brackets).toBe("int main() {\n  \n}");
    expect(enter("if True:", python()).doc.toString()).toBe("if True:\n  ");
  });
  it("preserves indentation for all cursors in one undoable edit", () => {
    const raw = "  int a;\n\tint b;";
    let state = EditorState.create({
      doc: raw,
      selection: EditorSelection.create([
        EditorSelection.cursor(8),
        EditorSelection.cursor(raw.length),
      ]),
      extensions: [
        cpp(),
        history(),
        EditorState.allowMultipleSelections.of(true),
      ],
    });
    insertSourceNewline({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    });
    expect(state.doc.toString()).toBe("  int a;\n  \n\tint b;\n\t");
    undo({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    });
    expect(state.doc.toString()).toBe(raw);
  });
  it("does not add indentation after a closed top-level scope or edit read-only text", () => {
    expect(enter("int f() {\n    return 1;\n}").doc.toString()).toBe(
      "int f() {\n    return 1;\n}\n",
    );
    const state = EditorState.create({
      doc: "  text",
      extensions: [EditorState.readOnly.of(true)],
    });
    expect(
      insertSourceNewline({
        state,
        dispatch: () => {
          throw Error("read-only edit");
        },
      }),
    ).toBe(false);
  });
});
