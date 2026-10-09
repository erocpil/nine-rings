import type { JSONContent } from "@tiptap/core";

/** Derive numbering and backlinks from document order, including legacy saved notes. */
export function normalizeFootnotes(doc: JSONContent): JSONContent {
  const references = new Map<string, { number: number; count: number }>();
  const visit = (node: JSONContent) => {
    for (const mark of node.marks ?? []) {
      if (mark.type !== "footnoteReference") continue;
      const id = String(mark.attrs?.id ?? "");
      let entry = references.get(id);
      if (!entry) {
        entry = { number: references.size + 1, count: 0 };
        references.set(id, entry);
      }
      entry.count++;
      mark.attrs = {
        ...mark.attrs,
        number: entry.number,
        occurrence: entry.count,
      };
      if (node.type === "text") node.text = String(entry.number);
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  const definitions = (node: JSONContent) => {
    if (node.type === "footnoteDefinition") {
      const entry = references.get(String(node.attrs?.id ?? ""));
      node.attrs = {
        ...node.attrs,
        number: entry?.number ?? null,
        references: entry?.count ?? 0,
      };
    }
    for (const child of node.content ?? []) definitions(child);
  };
  definitions(doc);
  return doc;
}
