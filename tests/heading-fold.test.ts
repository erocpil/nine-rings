import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import {
  collapsedHeadingContentRanges,
  collapsedHeadingKeysForAll,
  createSessionHeadingFoldStore,
  extractHeadingSections,
  headingSectionAtPosition,
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
assert.equal(headingSectionAtPosition(sections, sections[0].pos)?.key, sections[0].key, "标题位置命中自身章节");
assert.equal(headingSectionAtPosition(sections, sections[0].headingEnd)?.key, sections[0].key, "父标题后的正文命中父章节");
assert.equal(headingSectionAtPosition(sections, sections[1].headingEnd)?.key, sections[1].key, "下级正文优先命中最内层章节");
assert.equal(headingSectionAtPosition(sections, sections[2].pos)?.key, sections[2].key, "下一标题边界不会命中上一章节");
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
assert.deepEqual(
  collapsedHeadingKeysForAll(sections),
  sections.map((section) => section.key),
  "存在多个 H1 时全部折叠所有可折叠章节",
);
const singleRootDoc = schema.node("doc", null, [
  h(1, "唯一根标题"), p("根说明"),
  h(2, "章节一"), p("章节一正文"), h(3, "细节"), p("细节正文"),
  h(2, "章节二"), p("章节二正文"),
]);
const singleRootSections = extractHeadingSections(singleRootDoc);
const singleRootCollapsed = collapsedHeadingKeysForAll(singleRootSections);
assert.equal(singleRootCollapsed.includes(singleRootSections[0].key), false, "唯一 H1 在全部折叠时保持展开");
assert.deepEqual(
  visibleHeadingSections(singleRootSections, new Set(singleRootCollapsed)).map((section) => section.text),
  ["唯一根标题", "章节一", "章节二"],
  "唯一 H1 时总览保留到 H2 层级",
);
const store = createSessionHeadingFoldStore();
store.save("note-1", { version: 1, collapsedKeys: [sections[0].key] });
assert.deepEqual(store.load("note-1"), { version: 1, collapsedKeys: [sections[0].key] });
store.clear("note-1");
assert.equal(store.load("note-1"), null);
console.log("Heading fold model passed");
