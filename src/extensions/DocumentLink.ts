import { markPasteRule } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import { Plugin } from "@tiptap/pm/state";
import { bareLinkParts, CJK_LINK_BOUNDARY, malformedBareLink, shouldAutoLinkText } from "../lib/bare-autolinks";
/** Relative file destinations are authorized by their document host. Keep
 * scheme/control characters excluded; the upstream validator still owns URLs. */
export function isSafeRelativeFileHref(value: string): boolean {
  return Boolean(value.trim()) && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) && !/[\\:]/.test(value) && !/^\s*[/#]/.test(value);
}
/** Link titles must survive editor hydration and Markdown export. */
export const DocumentLink = Link.extend({
  addOptions() {
    return { ...this.parent?.(), shouldAutoLink: shouldAutoLinkText,
      // Some upstream link versions reject bare `folder/file.md` while
      // accepting `./folder/file.md`. Both are relative, never new schemes.
      isAllowedUri: (url, context) => context.defaultValidate(url) || isSafeRelativeFileHref(url),
    };
  },
  addPasteRules() {
    return [markPasteRule({
      type: this.type,
      find: text => {
        let index = 0;
        return bareLinkParts(text).flatMap(part => {
          const start = index;
          index += part.text.length;
          return part.href ? [{ text: part.text, index: start, data: { href: part.href } }] : [];
        });
      },
      getAttributes: match => ({ href: match.data?.href }),
    })];
  },
  addAttributes() {
    return { ...this.parent?.(), title: { default: null }, explicit: { default: false, rendered: false, parseHTML: () => true } };
  },
  addProseMirrorPlugins() {
    const linkType = this.type;
    return [new Plugin({
      props: {
        // ProseMirror handles mouseup before React receives click. Relative
        // files belong to the host, never the upstream window.open handler.
        handleClick: (_view, _pos, event) => {
          const href = (event.target as Element | null)?.closest("a[href]")?.getAttribute("href");
          return Boolean(href && isSafeRelativeFileHref(href));
        },
      },
    }), ...(this.parent?.() ?? []), new Plugin({
      appendTransaction(transactions, _old, state) {
        if (!transactions.some(tr => tr.docChanged) || transactions.some(tr => tr.getMeta("nr-autolink-repair"))) return null;
        const tr = state.tr;
        const visited = new Set<number>();
        transactions.forEach((transaction, index) => transaction.mapping.maps.forEach((map, step) => map.forEach((_a, _b, start, end) => {
          const tail = transaction.mapping.slice(step + 1);
          let from = tail.map(start), to = tail.map(end);
          for (const later of transactions.slice(index + 1)) { from = later.mapping.map(from); to = later.mapping.map(to); }
          const completeWord = !transactions.some(tr => tr.getMeta("preventAutolink")) && /\s$/.test(state.doc.textBetween(from, to, " ", " "));
          state.doc.nodesBetween(Math.max(0, from - 1), Math.min(state.doc.content.size, to + 1), (node, pos) => {
            if (!node.isTextblock || node.type.spec.code || visited.has(pos)) return;
            visited.add(pos);
            node.forEach((child, offset) => {
              const link = child.marks.find(mark => mark.type === linkType);
              const repair = link && !link.attrs.explicit && malformedBareLink(child.text ?? "", link.attrs.href, link.attrs.title);
              // Linkify's single-token validation rejects a URL followed by
              // Chinese punctuation. On a word-ending edit, recognize the
              // Chinese boundaries in unlinked prose too, leaving code and
              // explicit destinations untouched.
              const detect = completeWord && !link && child.isText && CJK_LINK_BOUNDARY.test(child.text!);
              if (!child.isText || child.marks.some(mark => mark.type.name === "code") || (!repair && !detect)) return;
              const start = pos + 1 + offset;
              if (repair) tr.removeMark(start, start + child.nodeSize, linkType);
              let at = start;
              for (const part of bareLinkParts(child.text!)) {
                if (part.href) tr.addMark(at, at + part.text.length, linkType.create({ href: part.href }));
                at += part.text.length;
              }
            });
            return false;
          });
        })));
        return tr.steps.length ? tr.setMeta("nr-autolink-repair", true).setMeta("preventAutolink", true) : null;
      },
    })];
  },
});
