import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { cpp } from "@codemirror/lang-cpp";
import {
  codeFolding,
  foldable,
  foldEffect,
  foldedRanges,
} from "@codemirror/language";
import { cSourceSupport } from "../../src/lib/source-code-highlighting";

describe("C/C++ adjacent branch folding", () => {
  it("keeps nested else branches separately reachable after folding if", () => {
    const doc =
      "if (outer) {\n  if (inner) {\n    first();\n  } else {\n    second();\n  }\n} else {\n  third();\n}";
    let state = EditorState.create({
      doc,
      extensions: [cSourceSupport(cpp()), codeFolding()],
    });
    for (const [ifLine, elseLine] of [
      [2, 4],
      [1, 7],
    ]) {
      const line = state.doc.line(ifLine);
      const range = foldable(state, line.from, line.to)!;
      expect(range).toBeTruthy();
      expect(
        state.doc.sliceString(range.to, state.doc.line(elseLine).to),
      ).toMatch(/^\n\s*} else \{$/);
      state = state.update({ effects: foldEffect.of(range) }).state;
      const branch = state.doc.line(elseLine);
      const branchRange = foldable(state, branch.from, branch.to)!;
      expect(branchRange).toBeTruthy();
      state = state.update({ effects: foldEffect.of(branchRange) }).state;
    }
    expect(foldedRanges(state).size).toBe(4);
    expect(state.doc.toString()).toBe(doc);
  });

  it("retains the compact placeholder for a standalone block", () => {
    const state = EditorState.create({
      doc: "void run() {\n  work();\n}",
      extensions: [cSourceSupport(cpp())],
    });
    const range = foldable(state, 0, state.doc.line(1).to)!;
    expect(state.doc.sliceString(range.to)).toBe("}");
  });
});
