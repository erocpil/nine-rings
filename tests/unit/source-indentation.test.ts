import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { history, undo } from "@codemirror/commands";
import { sourceIndentationChange } from "../../src/lib/source-indentation";

describe("source indentation conversion", () => {
  it("converts plain text without requiring a syntax parser", () => {
    const state = EditorState.create({ doc: "    plain" });
    expect(
      state
        .update(sourceIndentationChange(state, 4, "tabs")!)
        .state.doc.toString(),
    ).toBe("\tplain");
  });
  it("converts prefixes at each supported width without changing inline whitespace", () => {
    for (const size of [2, 4, 8]) {
      const raw =
        " ".repeat(size) +
        'printf("a  b\\t"); //  comment\n' +
        " ".repeat(size + 1) +
        "int n;";
      const state = EditorState.create({ doc: raw, extensions: [cpp()] });
      const change = sourceIndentationChange(state, size, "tabs")!;
      const converted = state.update(change).state;
      expect(converted.doc.toString()).toBe(
        '\tprintf("a  b\\t"); //  comment\n\t int n;',
      );
      expect(
        converted
          .update(sourceIndentationChange(converted, size, "spaces")!)
          .state.doc.toString(),
      ).toBe(raw);
    }
  });
  it("keeps multiline string and comment contents byte-for-byte", () => {
    for (const [language, raw] of [
      [
        cpp(),
        '    const char *s = R"(first\n    literal\n    )";\n    /* first\n    comment\n    */',
      ],
      [python(), '    value = """first\n    literal\n    """'],
    ] as const) {
      const state = EditorState.create({ doc: raw, extensions: [language] });
      const converted = state
        .update(sourceIndentationChange(state, 4, "tabs")!)
        .state.doc.toString();
      expect(converted).toBe(
        raw.replace(/^ {4}/, "\t").replace("\n    /* first", "\n\t/* first"),
      );
    }
  });
  it("conversion is independently undoable and read-only documents cannot change", () => {
    const raw = "    int n;";
    let state = EditorState.create({
      doc: raw,
      extensions: [cpp(), history()],
    });
    state = state.update(sourceIndentationChange(state, 4, "tabs")!).state;
    undo({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    });
    expect(state.doc.toString()).toBe(raw);
    expect(
      sourceIndentationChange(
        EditorState.create({
          doc: raw,
          extensions: [EditorState.readOnly.of(true)],
        }),
        4,
        "tabs",
      ),
    ).toBeNull();
  });
});
