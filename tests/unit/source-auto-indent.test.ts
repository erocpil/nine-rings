import { describe, expect, it } from "vitest";
import { cpp } from "@codemirror/lang-cpp";
import { history, undo } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { sourceAutoIndentChange } from "../../src/lib/source-auto-indent";

const unindented = "int main() {\nint value = 1;\nif (value) {\nvalue++;\n}\n}";

describe("source automatic indentation", () => {
  it("formats the whole document using the selected tab width and style", () => {
    const state = EditorState.create({
      doc: unindented,
      extensions: [cpp(), indentUnit.of("  ")],
    });
    const change = sourceAutoIndentChange(state, "document");
    expect(change).not.toBeNull();
    expect(state.update(change!).state.doc.toString()).toBe(
      "int main() {\n  int value = 1;\n  if (value) {\n    value++;\n  }\n}",
    );
  });

  it("reindents only selected lines and preserves the surrounding source", () => {
    const raw = "int main() {\nint value = 1;\nif (value) {\nvalue++;\n}\n}";
    const state = EditorState.create({
      doc: raw,
      selection: EditorSelection.range(raw.indexOf("int value"), raw.indexOf("\n}\n}") + 2),
      extensions: [cpp(), indentUnit.of("\t")],
    });
    const change = sourceAutoIndentChange(state, "selection");
    expect(change).not.toBeNull();
    expect(state.update(change!).state.doc.toString()).toBe(
      "int main() {\n\tint value = 1;\n\tif (value) {\n\t\tvalue++;\n\t}\n}",
    );
  });

  it("keeps automatic indentation as one undoable operation and rejects read-only state", () => {
    let state = EditorState.create({
      doc: unindented,
      extensions: [cpp(), indentUnit.of("\t"), history()],
    });
    state = state.update(sourceAutoIndentChange(state, "document")!).state;
    expect(state.doc.toString()).not.toBe(unindented);
    undo({ state, dispatch: transaction => { state = transaction.state; } });
    expect(state.doc.toString()).toBe(unindented);
    expect(sourceAutoIndentChange(
      EditorState.create({ doc: unindented, extensions: [EditorState.readOnly.of(true)] }),
      "document",
    )).toBeNull();
  });
});
