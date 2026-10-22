import { describe, expect, it } from "vitest";
import { cpp } from "@codemirror/lang-cpp";
import { history, undo } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { sourceAutoIndentChange } from "../../src/lib/source-auto-indent";

const unindented = "int main() {\nint value = 1;\nif (value) {\nvalue++;\n}\n}";

describe("source automatic indentation", () => {
  it.each([2, 4, 8])("indents multiline C/C++ calls and restores the following statement (Tab %i)", size => {
    const raw = [
      "void split() {",
      "n = block_init((struct Block *)((uintptr_t)b + BLOCK_SIZE + size),",
      "b->size - size - BLOCK_SIZE, b, b->next);",
      "run();",
      "}",
    ].join("\n");
    const state = EditorState.create({ doc: raw, extensions: [cpp(), EditorState.tabSize.of(size), indentUnit.of("\t")] });
    const formatted = state.update(sourceAutoIndentChange(state, "document")!).state;
    expect(formatted.doc.toString()).toBe([
      "void split() {",
      "\tn = block_init((struct Block *)((uintptr_t)b + BLOCK_SIZE + size),",
      "\t\t\tb->size - size - BLOCK_SIZE, b, b->next);",
      "\trun();",
      "}",
    ].join("\n"));
    expect(sourceAutoIndentChange(formatted, "document")).toBeNull();
  });

  it.each([
    ["nested calls", ["void f() {", "call(", "nested(", "value", "),", "other", ");", "next();", "}"], [0, 1, 3, 5, 3, 3, 1, 1, 0]],
    ["subscript and grouped condition", ["void f() {", "if (ready &&", "array[", "index", "]) {", "work();", "}", "}"], [0, 1, 3, 4, 1, 2, 1, 0]],
    ["multiline signature", ["namespace app {", "void f(int first,", "int second) {", "work();", "}", "}"], [0, 1, 3, 2, 1, 0]],
    ["initializer inside a call", ["void f() {", "call((struct Item){", ".value = 1,", "},", "other);", "next();", "}"], [0, 1, 2, 1, 3, 1, 0]],
    ["lambda argument", ["void f() {", "call(", "[](int value) {", "return value;", "}", ");", "}"], [0, 1, 3, 4, 3, 1, 0]],
    ["comments and strings", ["void f() {", 'call("([)]", // ) ]', "/* ) ] */ value);", "next();", "}"], [0, 1, 3, 1, 0]],
  ] as const)("handles %s without accumulating continuation indentation", (_name, lines, levels) => {
    const state = EditorState.create({ doc: lines.join("\n"), extensions: [cpp(), indentUnit.of("  ")] });
    const formatted = state.update(sourceAutoIndentChange(state, "document")!).state;
    expect(formatted.doc.toString()).toBe(lines.map((line, index) => "  ".repeat(levels[index]) + line).join("\n"));
    expect(sourceAutoIndentChange(formatted, "document")).toBeNull();
  });

  it("reindents a selected continuation using the full preceding source context", () => {
    const raw = "void f() {\n\tcall(first,\nlast);\n\tnext();\n}";
    const state = EditorState.create({
      doc: raw,
      selection: EditorSelection.range(raw.indexOf("last"), raw.indexOf("last") + 4),
      extensions: [cpp(), indentUnit.of("\t"), history()],
    });
    let updated = state.update(sourceAutoIndentChange(state, "selection")!).state;
    expect(updated.doc.toString()).toBe(raw.replace("\nlast", "\n\t\t\tlast"));
    undo({ state: updated, dispatch: transaction => { updated = transaction.state; } });
    expect(updated.doc.toString()).toBe(raw);
  });

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
      selection: EditorSelection.range(
        raw.indexOf("int value"),
        raw.indexOf("\n}\n}") + 2,
      ),
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
    undo({
      state,
      dispatch: (transaction) => {
        state = transaction.state;
      },
    });
    expect(state.doc.toString()).toBe(unindented);
    expect(
      sourceAutoIndentChange(
        EditorState.create({
          doc: unindented,
          extensions: [EditorState.readOnly.of(true)],
        }),
        "document",
      ),
    ).toBeNull();
  });

  it("keeps C++ class and later member scopes stable after a parser recovery", () => {
    const raw = [
      "class LRUCache {",
      "\tpublic:",
      "\t\tLRUCache(size_t capacity) : size(capacity), num(0) {",
      "\t\t\thead = new Entry();",
      "\t\t};",
      "\t\t~LRUCache() {",
      "\t\t\t// TODO delete all Entries",
      "\t\t\tdelete head;",
      "\t\t};",
      "\t\tint get(int key) {",
      "\t\t\tauto it = cache.find(key);",
      "\t\t\tif (it == cache.end()) return -1;",
      "\t\t\tEntry *e = it->second;",
      "\t\t\tdel(e);",
      "\t\t\tadd(e);",
      "\t\t\treturn e->val;",
      "\t\t}",
      "};",
    ].join("\n");
    const state = EditorState.create({
      doc: raw,
      extensions: [cpp(), indentUnit.of("\t")],
    });
    const change = sourceAutoIndentChange(state, "document");
    expect(change).not.toBeNull();
    expect(state.update(change!).state.doc.toString()).toBe(
      [
        "class LRUCache {",
        "public:",
        "\tLRUCache(size_t capacity) : size(capacity), num(0) {",
        "\t\thead = new Entry();",
        "\t};",
        "\t~LRUCache() {",
        "\t\t// TODO delete all Entries",
        "\t\tdelete head;",
        "\t};",
        "\tint get(int key) {",
        "\t\tauto it = cache.find(key);",
        "\t\tif (it == cache.end()) return -1;",
        "\t\tEntry *e = it->second;",
        "\t\tdel(e);",
        "\t\tadd(e);",
        "\t\treturn e->val;",
        "\t}",
        "};",
      ].join("\n"),
    );
  });

  it("preserves nested namespace and function levels around local classes", () => {
    const raw = [
      "namespace app {",
      "void create() {",
      "class Local {",
      "public:",
      "void run() {",
      "if (ready) {",
      "execute();",
      "}",
      "}",
      "private:",
      "int value;",
      "};",
      "}",
      "}",
    ].join("\n");
    const state = EditorState.create({
      doc: raw,
      extensions: [cpp(), indentUnit.of("  ")],
    });
    const change = sourceAutoIndentChange(state, "document");
    expect(change).not.toBeNull();
    expect(state.update(change!).state.doc.toString()).toBe(
      [
        "namespace app {",
        "  void create() {",
        "    class Local {",
        "    public:",
        "      void run() {",
        "        if (ready) {",
        "          execute();",
        "        }",
        "      }",
        "    private:",
        "      int value;",
        "    };",
        "  }",
        "}",
      ].join("\n"),
    );
  });

  it("aligns Qt access labels with the containing class", () => {
    const raw = [
      "namespace app {",
      "class Worker {",
      "public slots:",
      "void run() {",
      "work();",
      "}",
      "signals:",
      "void finished();",
      "};",
      "}",
    ].join("\n");
    const state = EditorState.create({
      doc: raw,
      extensions: [cpp(), indentUnit.of("  ")],
    });
    const change = sourceAutoIndentChange(state, "document");
    expect(change).not.toBeNull();
    expect(state.update(change!).state.doc.toString()).toBe(
      [
        "namespace app {",
        "  class Worker {",
        "  public slots:",
        "    void run() {",
        "      work();",
        "    }",
        "  signals:",
        "    void finished();",
        "  };",
        "}",
      ].join("\n"),
    );
  });

  it("does not alter braces or indentation inside a multiline raw string", () => {
    const raw = [
      "int main() {",
      'const char *value = R"tag({',
      "    literal indentation stays",
      '})tag";',
      "run();",
      "}",
    ].join("\n");
    const state = EditorState.create({
      doc: raw,
      extensions: [cpp(), indentUnit.of("\t")],
    });
    const change = sourceAutoIndentChange(state, "document");
    expect(change).not.toBeNull();
    expect(state.update(change!).state.doc.toString()).toBe(
      [
        "int main() {",
        '\tconst char *value = R"tag({',
        "    literal indentation stays",
        '})tag";',
        "\trun();",
        "}",
      ].join("\n"),
    );
  });
});
