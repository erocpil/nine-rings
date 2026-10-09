import { describe, expect, it } from "vitest";
import { mdToDelta } from "../../src/lib/md-parser";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
import { deltaToMarkdown } from "../../src/lib/markdown-serializer";
import { extractPlainText } from "../../src/lib/storage/core";

import {
  sourcePositionMap,
  renderedPositionMap,
  weightToSourceOffset,
} from "../../src/lib/markdown-view-position";

const parse = (text: string) => deltaToProseMirror(mdToDelta(text));
const roundtrip = (text: string) =>
  parse(deltaToMarkdown(proseMirrorToDelta(parse(text))));

describe("quoted Markdown structure", () => {
  const source =
    "> **范围**\n>\n> 说明：\n>\n> - `rte_mbuf` 与 `rte_mempool`\n> - **驱动**中的 ``a ` b``\n>\n> 参考 `IOVA=PA`。";
  it("preserves real lists and inline code through storage and Markdown export", () => {
    const doc = parse(source);
    const quote = doc.content[0];
    expect(quote.type).toBe("blockquote");
    expect(quote.content?.map((node) => node.type)).toContain("bulletList");
    const json = JSON.stringify(quote);
    expect(json).toContain('"type":"code"');
    expect(json).toContain("a ` b");
    expect(deltaToProseMirror(proseMirrorToDelta(doc))).toEqual(doc);
    expect(roundtrip(source)).toEqual(doc);
    expect(extractPlainText(proseMirrorToDelta(doc))).toContain(
      "rte_mbuf 与 rte_mempool",
    );
  });
  it("preserves nested quotes, ordered lists and fenced source", () => {
    const source =
      "> 1. first\n> 2. second\n>\n> > nested `code`\n>\n> ```text\n> a < b\n> ```";
    expect(parse(source).content[0].content?.map((node) => node.type)).toEqual([
      "orderedList",
      "blockquote",
      "codeBlock",
    ]);
    expect(roundtrip(source)).toEqual(parse(source));
  });
  it("keeps a structured quote inside a list item without adding an empty item", () => {
    const quote = parse("> - `nested` item").content[0];
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "parent" }],
                },
                quote,
              ],
            },
          ],
        },
      ],
    };
    const delta = proseMirrorToDelta(doc);
    expect(
      deltaToProseMirror(delta).content[0].content?.[0].content?.map(
        (node) => node.type,
      ),
    ).toEqual(["paragraph", "blockquote"]);
    const markdown = deltaToMarkdown(delta);
    expect(markdown).toContain("- parent\n\n  > - `nested` item");
    expect(
      markdown.split("\n").filter((line) => line.trim() === "-"),
    ).toHaveLength(0);
  });
  it("keeps source position weights aligned after a structured quote", () => {
    const source = "> - `first` item\n> - second item\n\nafter";
    const rendered = renderedPositionMap(parse(source));
    const spans = sourcePositionMap(source);
    expect(spans.at(-1)?.weightTo).toBe(rendered.at(-1)?.to);
    expect(weightToSourceOffset(source, rendered[1].from)).toBe(
      source.indexOf("after"),
    );
  });
  it.each(["", "\n", "\n\n"])(
    "retains the list boundary with %j blank lines",
    (gap) => {
      for (const block of [
        "> quote",
        "```text\nsource\n```",
        "> - nested list",
      ]) {
        const doc = parse(`- item\n${gap}${block}`);
        expect(doc.content[1].attrs?.indentExplicit === true).toBe(
          Boolean(gap),
        );
        const saved = roundtrip(`- item\n${gap}${block}`);
        expect(saved.content[1].attrs?.indentExplicit === true).toBe(
          Boolean(gap),
        );
        expect(saved.content[1].type).toBe(doc.content[1].type);
      }
    },
  );
  it("keeps explicit indentation even with a blank line", () => {
    for (const block of ["  > quote", "  ```text\nsource\n  ```"]) {
      const doc = parse(`- item\n\n${block}`);
      expect(doc.content[1].attrs).toMatchObject({
        indent: 1,
        indentExplicit: true,
      });
      expect(roundtrip(`- item\n\n${block}`).content[1].attrs).toMatchObject({
        indent: 1,
        indentExplicit: true,
      });
    }
  });
});
