import { Fragment, Schema, Slice } from "@tiptap/pm/model";
import { normalizeSingleParagraphPaste } from "../src/extensions/NormalizeSingleParagraphPaste";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    return;
  }
  console.error(`  FAIL: ${message}`);
  failed++;
}

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
    },
    hardBreak: { inline: true, group: "inline", selectable: false },
    text: { group: "inline" },
  },
  marks: {
    strong: {},
    link: { attrs: { href: {} }, inclusive: false },
  },
});

console.log("\n── NormalizeSingleParagraphPaste ──");

{
  const leading = schema.node("paragraph");
  const trailing = schema.node("paragraph", null, [schema.node("hardBreak")]);
  const content = schema.node("paragraph", null, [schema.text("正文")]);
  const input = new Slice(Fragment.fromArray([leading, content, trailing]), 1, 1);
  const output = normalizeSingleParagraphPaste(input);
  assert(output.content.childCount === 1, "leading and trailing empty paragraphs are removed");
  assert(output.content.firstChild?.textContent === "正文", "content remains after edge cleanup");
  assert(output.openStart === 0 && output.openEnd === 0, "cleaned paste is closed for stable insertion");
}

{
  const strong = schema.marks.strong.create();
  const link = schema.marks.link.create({ href: "https://example.com" });
  const paragraph = schema.node("paragraph", null, [
    schema.text("复制的", [strong]),
    schema.text("文本", [link]),
  ]);
  const input = new Slice(Fragment.from(paragraph), 0, 0);
  const output = normalizeSingleParagraphPaste(input);

  assert(output.content.childCount === 2, "single paragraph is flattened to inline nodes");
  assert(output.content.firstChild?.isText === true, "flattened content starts with text");
  assert(output.content.firstChild?.marks[0]?.type.name === "strong", "bold mark is preserved");
  assert(output.content.lastChild?.marks[0]?.attrs.href === "https://example.com", "link mark is preserved");
  assert(output.openStart === 0 && output.openEnd === 0, "inline slice is closed");
}

{
  const first = schema.node("paragraph", null, [schema.text("第一段")]);
  const second = schema.node("paragraph", null, [schema.text("第二段")]);
  const input = new Slice(Fragment.fromArray([first, second]), 0, 0);
  const output = normalizeSingleParagraphPaste(input);
  assert(output === input, "multiple paragraphs keep their block structure");
}

{
  const heading = schema.node("heading", { level: 1 }, [schema.text("标题")]);
  const input = new Slice(Fragment.from(heading), 0, 0);
  const output = normalizeSingleParagraphPaste(input);
  assert(output === input, "non-paragraph text blocks keep their structure");
}

{
  const paragraph = schema.node("paragraph", null, [
    schema.text("第一行"),
    schema.node("hardBreak"),
    schema.text("第二行"),
  ]);
  const input = new Slice(Fragment.from(paragraph), 0, 0);
  const output = normalizeSingleParagraphPaste(input);
  assert(output === input, "paragraphs containing explicit line breaks are not flattened");
}

{
  const paragraph = schema.node("paragraph", null, [
    schema.node("hardBreak"),
    schema.node("hardBreak"),
    schema.text("正文"),
    schema.node("hardBreak"),
    schema.node("hardBreak"),
  ]);
  const input = new Slice(Fragment.from(paragraph), 1, 1);
  const output = normalizeSingleParagraphPaste(input);
  assert(output.content.childCount === 1, "edge hard breaks are removed from one paragraph");
  assert(output.content.firstChild?.isText === true, "cleaned one-line paragraph is flattened");
  assert(output.content.textBetween(0, output.content.size) === "正文", "edge hard breaks do not survive");
}

{
  const paragraph = schema.node("paragraph", null, [
    schema.node("hardBreak"),
    schema.text("第一行"),
    schema.node("hardBreak"),
    schema.text("第二行"),
    schema.node("hardBreak"),
  ]);
  const input = new Slice(Fragment.from(paragraph), 1, 1);
  const output = normalizeSingleParagraphPaste(input);
  const cleaned = output.content.firstChild;
  assert(cleaned?.type.name === "paragraph", "internal hard breaks keep paragraph block structure");
  assert(cleaned?.childCount === 3, "only leading and trailing hard breaks are removed");
  assert(cleaned?.child(1).type.name === "hardBreak", "internal hard break is preserved");
}

{
  const first = schema.node("paragraph", null, [
    schema.node("hardBreak"),
    schema.text("第一段"),
  ]);
  const second = schema.node("paragraph", null, [
    schema.text("第二段"),
    schema.node("hardBreak"),
  ]);
  const input = new Slice(Fragment.fromArray([first, second]), 1, 1);
  const output = normalizeSingleParagraphPaste(input);
  assert(output.content.childCount === 2, "multiple content paragraphs remain separate");
  assert(output.content.firstChild?.childCount === 1, "leading boundary break is removed");
  assert(output.content.lastChild?.childCount === 1, "trailing boundary break is removed");
  assert(output.openStart === 1 && output.openEnd === 1, "open slice depth remains valid");
}

{
  const paragraph = schema.node("paragraph");
  const input = new Slice(Fragment.from(paragraph), 0, 0);
  const output = normalizeSingleParagraphPaste(input);
  assert(output.content.size === 0, "all-empty pasted paragraphs produce no content");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
