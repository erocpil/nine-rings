import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { cpp } from "@codemirror/lang-cpp";
import {
  codeFolding,
  foldable,
  foldEffect,
  foldedRanges,
  matchBrackets,
} from "@codemirror/language";
import { cSourceSupport } from "../../src/lib/source-code-highlighting";
import { cppDelimiterPairAt } from "../../src/lib/source-cpp-delimiters";

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

  it("pairs C designated initializers and the following function body lexically", () => {
    const doc = [
      "static const task_create_fn table[TASK_MAX] = {",
      "  [TASK_DRIVER] = task_create_driver,",
      "  [TASK_THREAD] = task_create_thread,",
      "};",
      "static const struct boot_module *find_module(const char *module, int type)",
      "{",
      "  if (type < 0 || type >= TASK_MAX) {",
      "    return NULL;",
      "  }",
      "  const struct boot_module_list *modules = task_conf.modules;",
      "  for (size_t i = 0; i < modules->count; i++) {",
      "    if (modules->items[i].path) {",
      "      continue;",
      "    }",
      "  }",
      "  if (module) {",
      "    return NULL;",
      "  }",
      "  return NULL;",
      "}",
    ].join("\n");
    const state = EditorState.create({
      doc,
      extensions: [cSourceSupport(cpp())],
    });
    const functionBrace = state.doc.line(6);
    const bodyRange = foldable(state, functionBrace.from, functionBrace.to)!;
    expect(bodyRange).toBeTruthy();
    expect(state.doc.lineAt(bodyRange.to).number).toBe(20);

    const firstIf = state.doc.line(7);
    const ifRange = foldable(state, firstIf.from, firstIf.to)!;
    expect(state.doc.lineAt(ifRange.to).number).toBe(9);

    for (const [lineNumber, char] of [
      [6, "{"],
      [11, "("],
      [1, "["],
    ] as const) {
      const line = state.doc.line(lineNumber);
      const position = line.from + line.text.indexOf(char);
      const match = matchBrackets(state, position, 1);
      expect(match?.matched).toBe(true);
      expect(match?.end).toBeTruthy();
      if (lineNumber === 6)
        expect(state.doc.lineAt(match!.end!.from).number).toBe(20);
      if (lineNumber === 11)
        expect(state.doc.sliceString(match!.end!.from, match!.end!.to)).toBe(
          ")",
        );
      if (lineNumber === 1)
        expect(state.doc.sliceString(match!.end!.from, match!.end!.to)).toBe(
          "]",
        );
    }
  });

  it("ignores delimiters in comments, continued strings, raw strings, and macros", () => {
    const source = [
      "{",
      '  const char *plain = "{ [ ( }";',
      '  const char *continued = "ignored \\',
      '    } ) ]";',
      "  // } \\",
      "  { still part of the line comment",
      "  /* ] }",
      "     [ { */",
      '  const char *raw = R"tag(',
      "    } ] )",
      '  )tag";',
      "#define FAKE(x) { x } \\",
      "  { ignored macro continuation }",
      "  void run() {",
      "    use(array[index], (a + b));",
      "  }",
      "}",
    ].join("\n");
    const outerOpen = source.indexOf("{");
    const outerClose = source.lastIndexOf("}");
    expect(cppDelimiterPairAt(source, outerOpen, "{")).toBe(outerClose);

    const functionOpen = source.indexOf("{", source.indexOf("void run"));
    const functionClose = source.indexOf("}", functionOpen);
    expect(cppDelimiterPairAt(source, functionOpen, "{")).toBe(functionClose);

    const arrayOpen = source.indexOf("[", source.indexOf("array"));
    const arrayClose = source.indexOf("]", arrayOpen);
    expect(cppDelimiterPairAt(source, arrayOpen, "[")).toBe(arrayClose);

    const callOpen = source.indexOf("(", source.indexOf("use("));
    const callClose = source.indexOf(");", callOpen);
    expect(cppDelimiterPairAt(source, callOpen, "(")).toBe(callClose);
  });

  it("keeps C-family folding attached to real braces when other pairs nest inside", () => {
    const doc = [
      "void run() {",
      '  const char *text = "} ] )";',
      "  // } \\",
      "  ] ) { still in this comment",
      "  /* } ] ) */",
      "#define FAKE(x) { x } \\",
      "  { ignored macro continuation }",
      "  if (items[index] && ready(value)) {",
      "    work();",
      "  }",
      "}",
    ].join("\n");
    const state = EditorState.create({
      doc,
      extensions: [cSourceSupport(cpp())],
    });
    const functionLine = state.doc.line(1);
    const functionRange = foldable(state, functionLine.from, functionLine.to)!;
    expect(state.doc.lineAt(functionRange.to).number).toBe(11);

    const branchLine = state.doc.line(8);
    const branchRange = foldable(state, branchLine.from, branchLine.to)!;
    expect(state.doc.lineAt(branchRange.to).number).toBe(10);
  });
});
