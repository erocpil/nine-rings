import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface ListLayout {
  from: number;
  to: number;
  style: string;
}

function romanLength(value: number): number {
  if (value < 1 || value > 3999) return String(value).length;
  const symbols: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"],
    [100, "c"], [90, "xc"], [50, "l"], [40, "xl"],
    [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let length = 0;
  for (const [unit, symbol] of symbols) {
    length += Math.floor(value / unit) * symbol.length;
    value %= unit;
  }
  return length;
}

export function listStyle(node: ProseMirrorNode): string {
  const start = Number.isSafeInteger(node.attrs.start) ? node.attrs.start as number : 1;
  const end = start + node.childCount - 1;
  const digits = Math.max(String(start).length, String(end).length);
  let alpha = 1;
  for (let value = end; value > 26; value = Math.floor((value - 1) / 26)) alpha++;
  let roman = digits;
  // Roman numerals are not monotonic in width (viii is wider than ix).
  // Their defined range is bounded, even for very large lists.
  for (let value = Math.max(1, start); value <= Math.min(end, 3999); value++) {
    roman = Math.max(roman, romanLength(value));
  }
  return [
    `--editor-ordered-decimal-column:${digits + 1}ch`,
    `--editor-ordered-alpha-column:${Math.max(alpha, digits) + 1}ch`,
    `--editor-ordered-roman-column:${roman + 1}em`,
    `--editor-ordered-counter-start:${start - 1}`,
  ].join(";");
}

/** Layout decorations preserve the schema, clipboard and editable DOM. */
export const OrderedListLayout = Extension.create({
  name: "orderedListLayout",

  addProseMirrorPlugins() {
    const cache = new WeakMap<ProseMirrorNode, ListLayout[]>();
    const styles = new Map<string, string>();
    // Positions are relative to the node's opening token. Unchanged subtrees
    // are reused, so typing doesn't rescan list text or measure the DOM.
    const layouts = (node: ProseMirrorNode): ListLayout[] => {
      const cached = cache.get(node);
      if (cached) return cached;
      const result: ListLayout[] = [];
      if (node.type.name === "orderedList") {
        const key = `${node.attrs.start}:${node.childCount}`;
        let style = styles.get(key);
        if (!style) {
          style = listStyle(node);
          if (styles.size > 128) styles.clear();
          styles.set(key, style);
        }
        result.push({ from: 0, to: node.nodeSize, style });
      }
      if (!node.isTextblock) node.forEach((child, offset) => {
        for (const item of layouts(child)) {
          result.push({ ...item, from: item.from + offset + 1, to: item.to + offset + 1 });
        }
      });
      cache.set(node, result);
      return result;
    };
    const decorate = (doc: ProseMirrorNode) => DecorationSet.create(doc,
      layouts(doc).map(({ from, to, style }) => Decoration.node(from - 1, to - 1, { style })),
    );
    return [new Plugin<DecorationSet>({
      state: {
        init: (_, state) => decorate(state.doc),
        apply: (transaction, previous) => transaction.docChanged ? decorate(transaction.doc) : previous,
      },
      props: { decorations(state) { return this.getState(state); } },
    })];
  },
});
