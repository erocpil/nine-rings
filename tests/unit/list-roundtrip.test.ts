import { deltaToMarkdown } from "../../src/lib/markdown-serializer";
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
const p = (text = ""): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
const item = (...content: JSONContent[]): JSONContent => ({
  type: "listItem",
  content,
});
const list = (...content: JSONContent[]): JSONContent => ({
  type: "orderedList",
  content,
});
const roundtrip = (...content: JSONContent[]) =>
  deltaToProseMirror(proseMirrorToDelta({ type: "doc", content }));

describe("list persistence", () => {
  it("exports list continuation blocks with indentation instead of extra numbers", () => {
    const delta = proseMirrorToDelta({
      type: "doc",
      content: [
        list(
          item(
            p("one"),
            {
              type: "codeBlock",
              attrs: { language: "text" },
              content: [{ type: "text", text: "a\nb" }],
            },
            { type: "blockquote", content: [p("quote")] },
          ),
          item(p("two")),
        ),
      ],
    });
    const markdown = deltaToMarkdown(delta);
    expect(markdown).toContain("1. one\n\n   ```text\n   a\n   b\n   ```");
    expect(markdown).toContain("   > quote");
    expect(markdown).toContain("2. two");
  });

  it("preserves continuation paragraphs and adjacent list boundaries", () => {
    const result = roundtrip(
      list(item(p("one"), p(), p("continued")), item(p("two"))),
      list(item(p("separate"))),
    );
    expect(result.content).toHaveLength(2);
    expect(result.content![0].content).toHaveLength(2);
    expect(result.content![0].content![0].content).toEqual([
      p("one"),
      p(),
      p("continued"),
    ]);
  });
  it("preserves multiline code, quote and nested lists after a continuation", () => {
    const result = roundtrip(
      list(
        item(
          p("one"),
          p("continued"),
          list(item(p("nested"))),
          {
            type: "codeBlock",
            attrs: {
              language: "typescript",
              title: "example",
              collapsed: true,
              wrap: false,
            },
            content: [{ type: "text", text: "a\nb\n" }],
          },
          {
            type: "blockquote",
            attrs: { collapsed: true },
            content: [p("quote"), p("second")],
          },
          p(),
        ),
      ),
    );
    const blocks = result.content![0].content![0].content!;
    expect(blocks.map((block) => block.type)).toEqual([
      "paragraph",
      "paragraph",
      "orderedList",
      "codeBlock",
      "blockquote",
      "paragraph",
    ]);
    expect(blocks[3].content![0].text).toBe("a\nb\n");
    expect(blocks[3].attrs).toMatchObject({
      language: "typescript",
      title: "example",
      collapsed: true,
      wrap: false,
    });
    expect(blocks[4].content).toEqual([p("quote"), p("second")]);
    expect(blocks[4].attrs?.collapsed).toBe(true);
    expect(proseMirrorToDelta(roundtrip(...result.content!))).toEqual(
      proseMirrorToDelta(result),
    );
  });
  it("reads legacy Delta lists without new metadata", () => {
    const result = deltaToProseMirror({
      ops: [
        { insert: "a" },
        { insert: "\n", attributes: { list: "ordered" } },
        { insert: "b" },
        { insert: "\n", attributes: { list: "ordered" } },
      ],
    });
    expect(result.content![0].content).toHaveLength(2);
  });
});
