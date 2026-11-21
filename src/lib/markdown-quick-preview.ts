import type { JSONContent } from "@tiptap/core";
import { SourceNavigationDocument } from "./markdown-source-navigation";
import { renderedPositionMap } from "./markdown-view-position";

export interface MarkdownQuickPreview {
  document: JSONContent;
  offsets: number[];
}

/** Parse against the complete file so trailing definitions resolve, then send
 * only a bounded prefix of complete blocks to the quick preview renderer. */
export function prepareMarkdownQuickPreview(source: string, limit: number): MarkdownQuickPreview {
  const revision = new SourceNavigationDocument(source, [], { sourceLanguage: "markdown" });
  const full = revision.document;
  const nodes = full.content ?? [];
  const entries = renderedPositionMap(full);
  const content: JSONContent[] = [];
  const offsets: number[] = [];
  const footnoteReferences = new Map<string, number>();
  function visit(node: JSONContent) {
    for (const mark of node.marks ?? []) {
      if (mark.type === "footnoteReference") {
        const id = String(mark.attrs?.id ?? "");
        footnoteReferences.set(id, (footnoteReferences.get(id) ?? 0) + 1);
      }
    }
    node.content?.forEach(visit);
  }
  for (const entry of entries) {
    const node = nodes[entry.index];
    if (node.type === "footnotes") continue;
    const offset = revision.offsetAt(entry.position + 1);
    if (offset >= limit || entry.to > limit) break;
    content.push(node);
    offsets.push(offset);
    visit(node);
  }
  const footnotes = nodes.find(node => node.type === "footnotes");
  const definitions = footnotes?.content?.flatMap(node => {
    const references = footnoteReferences.get(String(node.attrs?.id ?? ""));
    return references ? [{ ...node, attrs: { ...node.attrs, references } }] : [];
  });
  if (definitions?.length) {
    content.push({ ...footnotes, content: definitions });
    offsets.push(Math.min(limit, source.length));
  }
  return { document: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }, offsets };
}
