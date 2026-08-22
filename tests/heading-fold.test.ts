import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import {
  collapsedHeadingContentRanges,
  createSessionHeadingFoldStore,
  extractHeadingSections,
  visibleHeadingSections,
} from "../src/lib/heading-fold";

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
assert.deepEqual(
  visibleHeadingSections(sections, new Set([sections[0].key])).map((section) => section.text),
  ["总览", "总览"],
  "目录折叠父标题时隐藏其后代标题",
);
assert.deepEqual(
  collapsedHeadingContentRanges(doc, new Set([sections[0].key, sections[1].key])),
  [{ from: sections[0].headingEnd, to: sections[0].end }],
  "父章节的折叠区间覆盖子章节，隐藏范围保持不重叠",
);
assert.deepEqual(
  visibleHeadingSections(sections, new Set()).map((section) => section.text),
  ["总览", "细节", "总览"],
  "目录展开时显示全部标题",
);
const store = createSessionHeadingFoldStore();
store.save("note-1", { version: 1, collapsedKeys: [sections[0].key] });
assert.deepEqual(store.load("note-1"), { version: 1, collapsedKeys: [sections[0].key] });
store.clear("note-1");
assert.equal(store.load("note-1"), null);
console.log("Heading fold model passed");
