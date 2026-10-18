import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import {
  sourceFormats,
  removeSourceInlineFormat,
  sourceHeadingChange,
} from "../../src/lib/source-format-state";
const state = (doc: string, from: number, to = from) =>
  EditorState.create({
    doc,
    selection: EditorSelection.range(from, to),
    extensions: [markdown({ base: markdownLanguage }), history()],
  });
describe("source format recognition", () => {
  it.each([
    ["**bold**", "bold"],
    ["__bold__", "bold"],
    ["*word*", "italic"],
    ["_word_", "italic"],
    ["~~gone~~", "strike"],
    ["``a ` b``", "code"],
  ] as const)(
    "recognizes caret and complete marker selection: %s",
    (doc, format) => {
      expect(sourceFormats(state(doc, 3))[format]).toBe(true);
      expect(sourceFormats(state(doc, 0, doc.length))[format]).toBe(true);
      expect(sourceFormats(state(doc + " plain", doc.length + 3))[format]).toBe(
        false,
      );
      expect(
        sourceFormats(state(doc + " plain", 0, doc.length + 6))[format],
      ).toBe(false);
    },
  );
  it("does not mark escaped delimiters, incomplete markup or code literals", () => {
    expect(sourceFormats(state("\\*\\*literal\\*\\*", 6)).bold).toBe(false);
    expect(sourceFormats(state("**incomplete", 5)).bold).toBe(false);
    const code = sourceFormats(state("```md\n**literal**\n```", 11));
    expect(code.codeblock).toBe(true);
    expect(code.bold).toBe(false);
    expect(sourceFormats(state("`**literal**`", 5)).bold).toBe(false);
  });
  it("recognizes nested marks, headings, quotes, tasks and mixed selections", () => {
    const nested = sourceFormats(state("***both***", 5));
    expect(nested.bold && nested.italic).toBe(true);
    expect(sourceFormats(state("### title", 6)).h3).toBe(true);
    expect(sourceFormats(state("title\n=====", 3)).h1).toBe(true);
    const task = sourceFormats(state("> - [x] done", 10));
    expect(task.quote && task.todo).toBe(true);
    expect(task.bullet).toBe(false);
    expect(sourceFormats(state("1. text", 5)).ordered).toBe(true);
    expect(sourceFormats(state("**one** plain **two**", 2, 18)).bold).toBe(
      false,
    );
  });
  it.each(["__word__", "**word**", "``a ` b``"])(
    "removes the enclosing pair at the caret and undoes once: %s",
    (doc) => {
      let current = state(doc, 4);
      const format = doc.startsWith("`") ? "code" : "bold";
      current = current.update(
        removeSourceInlineFormat(current, format)!,
      ).state;
      expect(current.doc.toString()).toBe(
        doc.startsWith("`") ? "a ` b" : "word",
      );
      undo({
        get state() {
          return current;
        },
        dispatch: (tr) => {
          current = tr.state;
        },
      });
      expect(current.doc.toString()).toBe(doc);
    },
  );
  it("keeps backward selection and nested italic when removing strong", () => {
    const current = state("**one *two* three**", 10, 3);
    const next = current.update(
      removeSourceInlineFormat(current, "bold")!,
    ).state;
    expect(next.doc.toString()).toBe("one *two* three");
    expect(next.selection.main.anchor).toBe(8);
    expect(next.selection.main.head).toBe(1);
  });
  it("sets headings without removing quote/list prefixes and handles Setext and closing marks", () => {
    for (const [doc, pos, level, expected] of [
      ["> - title", 7, 3, "> - ### title"],
      ["## title ##", 5, 0, "title"],
      ["title\n=====\nnext", 3, 2, "## title\nnext"],
    ] as const) {
      const current = state(doc, pos);
      expect(
        current
          .update(sourceHeadingChange(current, level)!)
          .state.doc.toString(),
      ).toBe(expected);
    }
    expect(sourceHeadingChange(state("```\ncode\n```", 6), 2)).toBeNull();
  });
});
