import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import { extractDocumentOutline } from "../src/lib/document-outline";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    heading: {
      attrs: { level: { default: 1 } },
      content: "text*",
      group: "block",
    },
    text: { group: "inline" },
  },
});

const doc = schema.node("doc", null, [
  schema.node("heading", { level: 1 }, schema.text("总览")),
  schema.node("paragraph", null, schema.text("正文")),
  schema.node("heading", { level: 3 }, schema.text("实现细节")),
  schema.node("heading", { level: 2 }),
]);

const outline = extractDocumentOutline(doc);
assert.deepEqual(outline.map(({ level, text }) => ({ level, text })), [
  { level: 1, text: "总览" },
  { level: 3, text: "实现细节" },
  { level: 2, text: "未命名标题" },
]);
assert.equal(outline[0].pos, 0);
assert.ok(outline[1].pos > outline[0].pos);
assert.ok(outline[2].pos > outline[1].pos);

console.log("Document outline extraction passed");
