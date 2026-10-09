import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

/** Recompute derived reference labels after edits without adding a separate undo step. */
export function footnoteNumberingPlugin() {
  return new Plugin({
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((transaction) => transaction.docChanged))
        return null;
      const references = new Map<string, { number: number; count: number }>();
      const tr = state.tr;
      state.doc.descendants((node, position) => {
        const mark = node.marks.find(
          (mark) => mark.type.name === "footnoteReference",
        );
        if (!mark || !node.isText) return;
        const id = String(mark.attrs.id);
        let entry = references.get(id);
        if (!entry) {
          entry = { number: references.size + 1, count: 0 };
          references.set(id, entry);
        }
        entry.count++;
        if (
          mark.attrs.number === entry.number &&
          mark.attrs.occurrence === entry.count &&
          node.text === String(entry.number)
        )
          return;
        const replacement = mark.type.create({
          ...mark.attrs,
          number: entry.number,
          occurrence: entry.count,
        });
        tr.replaceWith(
          tr.mapping.map(position),
          tr.mapping.map(position + node.nodeSize),
          state.schema.text(
            String(entry.number),
            node.marks.map((item) => (item === mark ? replacement : item)),
          ),
        );
      });
      state.doc.descendants((node, position) => {
        if (node.type.name !== "footnoteDefinition") return;
        const entry = references.get(String(node.attrs.id));
        const number = entry?.number ?? null,
          count = entry?.count ?? 0;
        if (node.attrs.number !== number || node.attrs.references !== count)
          tr.setNodeMarkup(tr.mapping.map(position), undefined, {
            ...node.attrs,
            number,
            references: count,
          });
      });
      return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
    },
  });
}
export const FootnoteNumbering = Extension.create({
  name: "footnoteNumbering",
  addProseMirrorPlugins: () => [footnoteNumberingPlugin()],
});
