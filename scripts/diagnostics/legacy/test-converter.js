// Test the deltaToProseMirror logic
const delta = {ops: [
  {insert: "Hello World"},
  {insert: "\n", attributes: {header: 1}},
  {insert: "Some body text"},
  {insert: "\n"},
  {insert: "More text"},
  {insert: "\n"}
]};

const ops = delta.ops;
const doc = [];
let currentParagraph = { type: "paragraph", content: [] };

function flushParagraph() {
  if (currentParagraph.content.length > 0) {
    doc.push({ ...currentParagraph });
  }
  currentParagraph = { type: "paragraph", content: [] };
}

for (const op of ops) {
  const insert = op.insert;
  if (typeof insert === "string") {
    if (insert === "\n") {
      const attrs = op.attributes || {};
      if (attrs.header) {
        currentParagraph.type = "heading";
        currentParagraph.attrs = { level: attrs.header };
        flushParagraph();
      } else {
        flushParagraph();
      }
    } else {
      currentParagraph.content.push({ type: "text", text: insert });
    }
  }
}
flushParagraph();
console.log(JSON.stringify({type:"doc",content:doc}, null, 2));
