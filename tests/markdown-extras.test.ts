import { getSchema } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import { DocumentStarterKit } from "../src/extensions/DocumentStarterKit";
import { FootnoteDefinition, FootnoteReference, Footnotes, HTMLDetails, InlineHighlight, MathBlock, MathInline } from "../src/extensions/MarkdownExtras";
import { looksLikeMarkdown, mdToDelta } from "../src/lib/md-parser";
import { deltaToProseMirror, proseMirrorToDelta } from "../src/lib/delta-converter";
import { deltaToMarkdown } from "../src/lib/markdown-serializer";
import { shouldParseClipboardMarkdown } from "../src/lib/clipboard-content";
import { footnoteBlockPosition } from "../src/lib/footnote-navigation";

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
if (JSON.stringify(detailsDom).includes('"open":"false"')) throw new Error("Closed details must omit the Boolean open attribute");
const footnoteDom = schema.nodes.footnoteDefinition.spec.toDOM?.(schema.nodes.footnoteDefinition.create({ id: "1" }));
checkContentHole(footnoteDom);
if (!JSON.stringify(footnoteDom).includes("nr-footnote-ref-1") || !JSON.stringify(footnoteDom).includes("nr-footnote-1")) {
  throw new Error("Editable footnotes must provide a target and a return link");
}
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
for (const token of ["$E = mc^2$", "$$\n\\int_0^1", "<mark>高亮文本</mark>", "<details>", "[^1]: 这是脚注内容。"] ) {
  if (!markdown.includes(token)) throw new Error(`Markdown export omitted ${token}: ${markdown}`);
}
if (JSON.stringify(names(roundTrip)) !== JSON.stringify(parsedNames)) throw new Error(`Markdown extras changed node/mark types in a round-trip: ${JSON.stringify(parsedNames)} -> ${JSON.stringify(names(roundTrip))}`);

if (!looksLikeMarkdown("脚注[^1]\n\n[^1]: 脚注内容")) throw new Error("Footnote-only Markdown must be recognized on paste");
if (!shouldParseClipboardMarkdown("脚注[^1]\n\n[^1]: 脚注内容")) throw new Error("Footnote-only clipboard content must be parsed as Markdown");
if (!shouldParseClipboardMarkdown("脚注[^1]")) throw new Error("A standalone footnote reference must be recognized on paste");
if (!names(deltaToProseMirror(mdToDelta("脚注[^1]"))).includes("mark:footnoteReference")) {
  throw new Error("A footnote reference pasted before its definition must remain semantic");
}
const escapedReference = deltaToProseMirror(mdToDelta("脚注\\[^1\\]\n\n[^1]: 脚注内容"));
if (names(escapedReference).includes("mark:footnoteReference")) throw new Error("Deliberately escaped references must remain literal");
const plainReferenceMarkdown = deltaToMarkdown({ ops: [{ insert: "脚注[^1]" }, { insert: "\n" }] });
if (!plainReferenceMarkdown.includes("\\[")) throw new Error("Literal footnote brackets must remain literal after export");

const sample = "### 脚注\nMarkdown 支持脚注[^1]，用于补充说明与引用。\n[^1]: 这是一条脚注——点击箭头可返回原处。";
const sampleDoc = deltaToProseMirror(mdToDelta(sample));
schema.nodeFromJSON(sampleDoc).check();
if (sampleDoc.content?.slice(-2).map(node => node.type).join(",") !== "horizontalRule,footnotes") {
  throw new Error("Footnotes must end the document after one horizontal rule");
}
const parsedSample = schema.nodeFromJSON(sampleDoc);
if (footnoteBlockPosition(parsedSample, "nr-footnote-1") === null || footnoteBlockPosition(parsedSample, "nr-footnote-ref-1") === null) {
  throw new Error("Both ends of a footnote must be navigable in a virtual reader");
}
const exportedSample = deltaToMarkdown(proseMirrorToDelta(sampleDoc));
if (!exportedSample.includes("\n\n---\n\n[^1]: 这是一条脚注——点击箭头可返回原处。")) {
  throw new Error(`Markdown export must separate footnotes from the body: ${exportedSample}`);
}
for (const input of [exportedSample, `${sample.replace("\n[^1]:", "\n---\n[^1]:")}`]) {
  const roundTripDoc = deltaToProseMirror(mdToDelta(input));
  schema.nodeFromJSON(roundTripDoc).check();
  if (roundTripDoc.content?.filter(node => node.type === "horizontalRule").length !== 1 ||
      roundTripDoc.content?.[roundTripDoc.content.length - 1]?.type !== "footnotes") {
    throw new Error("Importing footnotes twice must not duplicate the separator");
  }
}
const legacyFootnotes = deltaToProseMirror({ ops: [
  { insert: { footnotes: [{ id: "1", content: [{ insert: "内容" }] }] } },
  { insert: "\n" }, { insert: "后续正文" }, { insert: "\n" },
] });
if (legacyFootnotes.content?.map(node => node.type).join(",") !== "paragraph,horizontalRule,footnotes") {
  throw new Error("Existing footnote embeds must move to the document end");
}
const twoNotes = deltaToProseMirror(mdToDelta("甲[^a]和乙[^b]\n[^a]: 第一条\n[^b]: 第二条"));
if (twoNotes.content?.[twoNotes.content.length - 1]?.content?.map(node => node.attrs?.id).join(",") !== "a,b") {
  throw new Error("Each footnote definition must retain its own return target");
}
for (const id of ["a", "b"]) {
  const parsed = schema.nodeFromJSON(twoNotes);
  if (footnoteBlockPosition(parsed, `nr-footnote-${id}`) === null || footnoteBlockPosition(parsed, `nr-footnote-ref-${id}`) === null) {
    throw new Error(`Footnote ${id} lost its link target`);
  }
}

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
