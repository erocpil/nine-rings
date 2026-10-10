import { DOMSerializer, type Node } from "@tiptap/pm/model";
import { clipboardSliceToPlainText } from "./clipboard-plain-text";
import { copyToClipboard } from "./clipboard";
import { proseMirrorToDelta } from "./delta-converter";
import { deltaToMarkdown } from "./markdown-serializer";
export async function copyDocumentBlock(doc: Node, position: number, mode: "formatted" | "markdown" | "text") {
  const node = doc.nodeAt(position);
  if (!node) throw new Error("Block no longer exists");
  const slice = doc.slice(position, position + node.nodeSize);
  const text = mode === "markdown" ? deltaToMarkdown(proseMirrorToDelta({ type: "doc", content: [node.toJSON()] })) : clipboardSliceToPlainText(slice);
  if (mode === "formatted") {
    try {
      const container = document.createElement("div");
      container.append(DOMSerializer.fromSchema(doc.type.schema).serializeFragment(slice.content));
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([container.innerHTML], { type: "text/html" }) })]);
      return;
    } catch { /* Preserve plain text when rich clipboard access is restricted. */ }
  }
  await copyToClipboard(text, { reportFailure: true });
}
