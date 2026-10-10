import { DOMParser as PMDOMParser, Fragment, type Node, type Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { normalizePastedHTML } from "../extensions/NormalizeSingleParagraphPaste";
import { shouldParseClipboardMarkdown } from "./clipboard-content";
import { deltaToProseMirror } from "./delta-converter";
import { mdToDelta } from "./md-parser";
import { markdownToProseMirrorAsync } from "./data-transform-client";
import type { DocumentBookmark, DocumentReferenceAnchor } from "../types/models";

const VISUAL_MARKS = new Set(["bold", "italic", "strike", "underline", "textStyle", "inlineHighlight", "highlight"]);

/** Clear visual overrides throughout a compound block without removing semantic marks/nodes. */
export function clearBlockTextStyles(tr: Transaction, position: number): Transaction {
  const block = tr.doc.nodeAt(position);
  if (!block) return tr;
  block.descendants((node, offset) => {
    if (!node.isInline) return;
    for (const mark of node.marks) {
      if (VISUAL_MARKS.has(mark.type.name)) tr.removeMark(position + 1 + offset, position + 1 + offset + node.nodeSize, mark);
    }
  });
  return tr;
}

/** Parse whole sibling blocks, rather than joining the target's paragraph/list context. */
export async function clipboardBlockFragment(schema: Schema, text: string, html: string): Promise<Fragment> {
  if (!text.trim() && !html.trim()) return Fragment.empty;
  let fragment: Fragment;
  if (text && shouldParseClipboardMarkdown(text, html)) {
    const parsed = text.length >= 20_000 || text.split("\n", 501).length > 500
      ? await markdownToProseMirrorAsync(text) : deltaToProseMirror(mdToDelta(text));
    fragment = Fragment.fromArray(parsed.content.map(block => schema.nodeFromJSON(block)));
  } else if (html) {
    const container = document.createElement("div");
    container.innerHTML = normalizePastedHTML(html);
    fragment = PMDOMParser.fromSchema(schema).parse(container).content;
  } else {
    fragment = Fragment.fromArray(text.replace(/\r\n?/g, "\n").split("\n").map(line => schema.node("paragraph", null, line ? schema.text(line) : undefined)));
  }
  fragment.forEach(node => node.check());
  if (!schema.topNodeType.validContent(fragment)) throw new Error("Clipboard does not contain valid document blocks");
  return fragment;
}

interface CutBlock {
  token: string;
  noteId: string;
  node: Node;
  anchors: DocumentReferenceAnchor[];
  bookmarks: DocumentBookmark[];
}
let cutBlock: CutBlock | undefined;
export function rememberCutBlock(block: CutBlock) { cutBlock = block; }
export function clipboardCutBlock(html: string): CutBlock | undefined {
  if (!cutBlock || !html) return;
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.querySelector("[data-nr-cut-block]")?.getAttribute("data-nr-cut-block") === cutBlock.token ? cutBlock : undefined;
}
