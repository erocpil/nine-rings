import { getSchema } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import { DocumentStarterKit } from "../src/extensions/DocumentStarterKit";
import { FootnoteDefinition, FootnoteReference, Footnotes, HTMLDetails, InlineHighlight, MathBlock, MathInline } from "../src/extensions/MarkdownExtras";
import { looksLikeMarkdown, mdToDelta } from "../src/lib/md-parser";
import { deltaToProseMirror, proseMirrorToDelta } from "../src/lib/delta-converter";
import { deltaToMarkdown } from "../src/lib/markdown-serializer";
import { shouldParseClipboardMarkdown } from "../src/lib/clipboard-content";

const schema = getSchema([DocumentStarterKit, Link, MathInline, MathBlock, InlineHighlight, FootnoteReference, HTMLDetails, FootnoteDefinition, Footnotes]);
const detailsType = schema.nodes.htmlDetails;
const detailsDom = detailsType.spec.toDOM?.(detailsType.create({ summary: "summary", open: false }));
const checkContentHole = (spec: unknown): void => {
  if (!Array.isArray(spec)) return;
  const children = spec.slice(typeof spec[1] === "object" && spec[1] !== null ? 2 : 1);
  if (children.includes(0) && children.length !== 1) {
    throw new Error("ProseMirror content holes must be the only child of their parent DOM node");
  }
  for (const child of children) checkContentHole(child);
};
checkContentHole(detailsDom);
const source = [
  "脚注[^1]、行内公式 $E = mc^2$ 和 \\(a+b\\)。",
  "",
  "$$\\int_0^1 x\\,dx = \\frac{1}{2}$$的公式说明。",
  "",
  "<mark>高亮文本</mark>",
  "",
  "<details><summary>点击展开</summary>",
  "",
  "这里是被折叠的内容。",
  "",
  "</details>",
  "",
  "[^1]: 这是脚注内容。",
].join("\n");

const delta = mdToDelta(source);
const document = deltaToProseMirror(delta);
schema.nodeFromJSON(document).check();
const normalized = proseMirrorToDelta(document);
const markdown = deltaToMarkdown(normalized);
const roundTrip = deltaToProseMirror(mdToDelta(markdown));
schema.nodeFromJSON(roundTrip).check();

const names = (value: typeof document): string[] => {
  const result: string[] = [];
  const visit = (node: (typeof document) | NonNullable<(typeof document.content)[number]>) => {
    if (node.type) result.push(node.type);
    for (const child of node.content ?? []) visit(child as typeof document);
    for (const mark of node.marks ?? []) result.push(`mark:${mark.type}`);
  };
  visit(value);
  return result;
};
const parsedNames = names(document);
for (const type of ["mathInline", "mathBlock", "htmlDetails", "footnotes", "footnoteDefinition"]) {
  if (!parsedNames.includes(type)) throw new Error(`Expected supported Markdown block ${type}`);
}
for (const type of ["inlineHighlight", "footnoteReference"]) {
  if (!parsedNames.includes(`mark:${type}`)) throw new Error(`Expected supported Markdown mark ${type}`);
}
for (const token of ["$E = mc^2$", "$$\\int_0^1", "<mark>高亮文本</mark>", "<details>", "[^1]: 这是脚注内容。"] ) {
  if (!markdown.includes(token)) throw new Error(`Markdown export omitted ${token}: ${markdown}`);
}
if (JSON.stringify(names(roundTrip)) !== JSON.stringify(parsedNames)) throw new Error("Markdown extras changed node/mark types in a round-trip");

if (!looksLikeMarkdown("脚注[^1]\n\n[^1]: 脚注内容")) throw new Error("Footnote-only Markdown must be recognized on paste");
if (!shouldParseClipboardMarkdown("脚注[^1]\n\n[^1]: 脚注内容")) throw new Error("Footnote-only clipboard content must be parsed as Markdown");
if (!shouldParseClipboardMarkdown("脚注[^1]")) throw new Error("A standalone footnote reference must be recognized on paste");
if (!names(deltaToProseMirror(mdToDelta("脚注[^1]"))).includes("mark:footnoteReference")) {
  throw new Error("A footnote reference pasted before its definition must remain semantic");
}
const escapedReference = deltaToProseMirror(mdToDelta("脚注\\[^1\\]\n\n[^1]: 脚注内容"));
if (!names(escapedReference).includes("mark:footnoteReference")) throw new Error("Previously auto-escaped footnote references should still resolve");
const plainReferenceMarkdown = deltaToMarkdown({ ops: [{ insert: "脚注[^1]" }, { insert: "\n" }] });
if (plainReferenceMarkdown.includes("\\[")) throw new Error("Markdown export must not escape footnote brackets");

const formulaWithSuffix = deltaToProseMirror(mdToDelta("$$x^2$$的说明"));
if (formulaWithSuffix.content[0]?.type !== "mathBlock" || formulaWithSuffix.content[1]?.type !== "paragraph") {
  throw new Error("Block math closing delimiter followed by prose must stay a math block");
}

const untrusted = mdToDelta('<script>alert("x")</script>');
if (untrusted.ops.some(op => typeof op.insert === "object" && op.insert && "htmlDetails" in op.insert)) {
  throw new Error("Arbitrary HTML must not be converted into an active HTML node");
}
const fencedFootnote = mdToDelta("```text\n[^not-a-note]: literal\n```");
if (fencedFootnote.ops.some(op => typeof op.insert === "object" && op.insert && "footnotes" in op.insert)) {
  throw new Error("Footnote-like text inside a code fence must remain code");
}
console.log("Markdown extras import/export and schema validation passed");
