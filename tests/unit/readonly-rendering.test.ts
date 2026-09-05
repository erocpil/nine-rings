import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  buildReadonlyDocument,
  ReadingLayout,
  readingBlocks,
  handoffReadingAnchor,
  takeReadingAnchor,
} from "../../src/lib/readonly-rendering";
import {
  collapsedHeadingKeysForAll,
  extractHeadingSections,
} from "../../src/lib/heading-fold";

const schema = getSchema([StarterKit]);
const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const heading = (text: string) => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});

describe("readonly window model", () => {
  it("rejects unsupported nodes and marks instead of dropping content", () => {
    expect(
      buildReadonlyDocument(
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "document link",
                  marks: [
                    { type: "link", attrs: { href: "nr://note/example" } },
                  ],
                },
              ],
            },
          ],
        },
        schema,
      ),
    ).toBeNull();
    expect(
      buildReadonlyDocument(
        {
          type: "doc",
          content: [{ type: "image", attrs: { src: "test.png" } }],
        },
        schema,
      ),
    ).toBeNull();
    expect(
      buildReadonlyDocument(
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "kept", marks: [{ type: "unknown" }] },
              ],
            },
          ],
        },
        schema,
      ),
    ).toBeNull();
    expect(
      buildReadonlyDocument(
        { type: "doc", content: [paragraph("x".repeat(50001))] },
        schema,
      ),
    ).toBeNull();
    expect(
      buildReadonlyDocument(
        { ops: [{ insert: "hello" }, { insert: "\n" }] },
        schema,
      )?.textContent,
    ).toBe("hello");
  });
  it("keeps original block numbers and final headings after folding", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        heading("one"),
        paragraph("a"),
        heading("two"),
        paragraph("b"),
        heading("last"),
        paragraph("c"),
      ],
    });
    const keys = collapsedHeadingKeysForAll(extractHeadingSections(doc));
    const blocks = readingBlocks(doc, new Set(keys));
    expect(blocks.map((block) => block.number)).toEqual([1, 3, 5]);
    expect(blocks.map((block) => block.node.textContent)).toEqual([
      "one",
      "two",
      "last",
    ]);
    const layout = new ReadingLayout(
      blocks,
      new Map(blocks.map((block) => [block.pos, 80])),
    );
    expect(layout.total).toBe(240);
    expect(layout.atPosition(doc.content.size - 1)).toBe(2);
    expect(layout.atOffset(10000)).toBe(2);
  });
  it("limits mounting and resolves variable heights at exact boundaries", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: Array.from({ length: 5000 }, (_, index) =>
        paragraph(String(index)),
      ),
    });
    const blocks = readingBlocks(doc, new Set());
    const layout = new ReadingLayout(
      blocks,
      new Map([
        [blocks[0].pos, 20],
        [blocks[1].pos, 300],
      ]),
    );
    expect(layout.atOffset(19)).toBe(0);
    expect(layout.atOffset(20)).toBe(1);
    expect(layout.atOffset(320)).toBe(2);
    const [start, end] = layout.window(100000, 800);
    expect(end - start).toBeLessThan(30);
    expect(layout.atPosition(blocks[4999].pos)).toBe(4999);
  });
  it("consumes renderer handoffs once, separately per document", () => {
    handoffReadingAnchor("a", { position: 42, offset: 19 });
    expect(takeReadingAnchor("b")).toBeUndefined();
    expect(takeReadingAnchor("a")).toEqual({ position: 42, offset: 19 });
    expect(takeReadingAnchor("a")).toBeUndefined();
  });
});
