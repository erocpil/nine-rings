import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import { createSessionHeadingFoldStore, extractHeadingSections } from "../src/lib/heading-fold";

const schema = new Schema({ nodes: {
  doc: { content: "block+" }, paragraph: { content: "text*", group: "block" },
  heading: { attrs: { level: { default: 1 } }, content: "text*", group: "block" }, text: { group: "inline" },
} });
const h = (level: number, text: string) => schema.node("heading", { level }, schema.text(text));
const p = (text: string) => schema.node("paragraph", null, schema.text(text));
const doc = schema.node("doc", null, [h(1, "总览"), p("总览正文"), h(2, "细节"), p("细节正文"), h(1, "总览"), p("第二部分")]);
const sections = extractHeadingSections(doc);
assert.equal(sections.length, 3);
assert.equal(sections[0].end, sections[2].pos, "H1 包含下级 H2，直到下一个 H1");
assert.equal(sections[1].end, sections[2].pos, "H2 在下一个更高层标题前结束");
assert.notEqual(sections[0].key, sections[2].key, "同名同级标题用序号形成唯一键");
assert.deepEqual(sections[1].ancestorKeys, [sections[0].key], "章节保留完整祖先键链");
const store = createSessionHeadingFoldStore();
store.save("note-1", { version: 1, collapsedKeys: [sections[0].key] });
assert.deepEqual(store.load("note-1"), { version: 1, collapsedKeys: [sections[0].key] });
store.clear("note-1");
assert.equal(store.load("note-1"), null);
console.log("Heading fold model passed");
