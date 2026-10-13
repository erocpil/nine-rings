import { expect, it } from "vitest";
import { Schema, Slice } from "@tiptap/pm/model";
import { clipboardSliceToPlainText } from "../../src/lib/clipboard-plain-text";
import { tocClipboardSerializer } from "../../src/lib/toc-clipboard";
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 } },
      toDOM: () => ["h1", 0],
    },
    codeBlock: {
      group: "block",
      content: "text*",
      attrs: { language: { default: null } },
      toDOM: () => ["pre", ["code", 0]],
    },
  },
});
const toc = schema.node(
  "codeBlock",
  { language: "toc" },
  schema.text("levels: 1,2,3,4,5,6"),
);
const doc = schema.node("doc", null, [
  toc,
  schema.node("heading", { level: 1 }, schema.text("开始")),
  schema.node("heading", { level: 6 }, schema.text("结束")),
]);
it("visible TOC copy contains headings, not levels configuration", () => {
  expect(clipboardSliceToPlainText(doc.slice(0, toc.nodeSize), doc)).toBe(
    "开始\n结束",
  );
  expect(
    clipboardSliceToPlainText(new Slice(doc.content, 0, 0), doc),
  ).not.toContain("levels:");
});
it("rich copy is visible text with an invisible dynamic-block attribute", () => {
  const serializer = tocClipboardSerializer(schema, () => doc);
  const rendered = serializer.nodes.codeBlock(toc) as unknown[];
  expect(rendered[0]).toBe("div");
  expect(rendered[1]).toEqual({ "data-nr-toc": "levels: 1,2,3,4,5,6" });
  expect(JSON.stringify(rendered.slice(2))).not.toContain("levels:");
  expect(JSON.stringify(rendered.slice(2))).toContain("开始");
});
