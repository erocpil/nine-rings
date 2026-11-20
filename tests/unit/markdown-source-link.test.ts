import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { expect, it } from "vitest";
import { markdownSourceLinkAt } from "../../src/lib/markdown-source-link";

it("reads inline, fragment, autolink and reference targets at the pointer", () => {
  const doc = [
    '[relative](<./folder/file.md#part> "title")',
    "[heading](#section) <https://example.com>",
    "[named reference][Key] [other][]",
    "",
    "[key]: notes.md",
    "[other]: ../read.md",
    "",
    "![an image](picture.png) `[code](example.md)`",
  ].join("\n");
  const state = EditorState.create({ doc, extensions: [markdown()] });
  const link = (text: string) =>
    markdownSourceLinkAt(state, doc.indexOf(text) + 1);
  expect(link("relative")).toBe("./folder/file.md#part");
  expect(link("heading")).toBe("#section");
  expect(link("https")).toBe("https://example.com");
  expect(link("named reference")).toBe("notes.md");
  expect(link("other")).toBe("../read.md");
  expect(link("an image")).toBeUndefined();
  expect(link("code")).toBeUndefined();
});
