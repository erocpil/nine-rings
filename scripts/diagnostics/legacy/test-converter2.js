// Test the ACTUAL converter from the codebase
// Copy the relevant functions

function deltaAttrToMarks(attrs) {
  const marks = [];
  if (attrs.bold) marks.push({ type: "bold" });
  if (attrs.italic) marks.push({ type: "italic" });
  if (attrs.strike) marks.push({ type: "strike" });
  if (attrs.code) marks.push({ type: "code" });
  if (attrs.link) marks.push({ type: "link", attrs: { href: attrs.link } });
  if (attrs.color) marks.push({ type: "textStyle", attrs: { color: attrs.color } });
  return marks;
}

function isProseMirror(content) {
  if (!content || typeof content !== "object") return false;
  return content.type === "doc" && Array.isArray(content.content);
}

function isDelta(content) {
  if (!content || typeof content !== "object") return false;
  return Array.isArray(content.ops) || content?.delta?.ops;
}

function deltaToProseMirror(deltaData) {
  const ops = deltaData?.ops ?? deltaData?.delta?.ops ?? [];
  const doc = [];
  let currentParagraph = { type: "paragraph", content: [] };
  let isImageBlock = false;

  function flushParagraph() {
    if (currentParagraph.content.length > 0 || isImageBlock) {
      doc.push({ ...currentParagraph });
    }
    currentParagraph = { type: "paragraph", content: [] };
    isImageBlock = false;
  }

  for (const op of ops) {
    const insert = op.insert;
    const attrs = op.attributes ?? {};

    if (typeof insert === "string") {
      if (insert === "\n") {
        if (attrs.header) {
          currentParagraph.type = "heading";
          currentParagraph.attrs = { level: attrs.header };
          flushParagraph();
        } else if (attrs["code-block"]) {
          currentParagraph.type = "codeBlock";
          flushParagraph();
        } else if (attrs.blockquote) {
          currentParagraph.type = "blockquote";
          flushParagraph();
        } else if (attrs.list === "bullet") {
          currentParagraph.type = "bulletList";
          currentParagraph.content.push({
            type: "listItem",
            content: [{ type: "paragraph", content: extractInlineContent(currentParagraph) }],
          });
          flushParagraph();
        } else {
          flushParagraph();
        }
      } else {
        const marks = deltaAttrToMarks(attrs);
        currentParagraph.content.push({
          type: "text",
          text: insert,
          ...(marks.length > 0 ? { marks } : {}),
        });
      }
    }
  }
  flushParagraph();
  return { type: "doc", content: doc };
}

function extractInlineContent(para) {
  return para.content ?? [];
}

// Test
const delta = {ops: [
  {insert: "Informer Worker Deployment"},
  {insert: "\n", attributes: {header: 1}},
  {insert: "This document describes the deployment."},
  {insert: "\n"},
  {insert: "Architecture"},
  {insert: "\n", attributes: {header: 2}},
  {insert: "The system consists of three components."},
  {insert: "\n"}
]};

console.log("isDelta:", isDelta(delta));
console.log("isProseMirror:", isProseMirror(delta));

const pm = deltaToProseMirror(delta);
console.log("\n=== ProseMirror Output ===");
console.log(JSON.stringify(pm, null, 2));

// Also test empty note
const emptyDelta = {ops: []};
console.log("\n=== Empty Delta ===");
console.log(JSON.stringify(deltaToProseMirror(emptyDelta), null, 2));
