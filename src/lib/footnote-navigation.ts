import type { Node as PMNode } from "@tiptap/pm/model";

/** Only footnote links inside the current document may navigate its anchors. */
export function footnoteLinkTarget(target: EventTarget | null): string | null {
  const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href^="#nr-footnote-"]') : null;
  const id = link?.getAttribute("href")?.slice(1) ?? "";
  return /^nr-footnote-(?:ref-)?[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

export function findFootnoteElement(root: HTMLElement, id: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>("[id]")].find(element => element.id === id) ?? null;
}

export function scrollToFootnote(root: HTMLElement, id: string): boolean {
  const target = findFootnoteElement(root, id);
  if (!target) return false;
  target.scrollIntoView({ block: "center" });
  target.focus({ preventScroll: true });
  return true;
}

/** Find the top-level block to mount before navigating a virtual reader. */
export function footnoteBlockPosition(doc: PMNode, targetId: string): number | null {
  const reference = targetId.startsWith("nr-footnote-ref-");
  const id = decodeURIComponent(targetId.slice(reference ? "nr-footnote-ref-".length : "nr-footnote-".length));
  let result: number | null = null;
  doc.forEach((block, position) => {
    if (result !== null) return;
    if (!reference && block.type.name === "footnotes") {
      block.forEach(definition => {
        if (String(definition.attrs.id) === id) result = position;
      });
    } else if (reference) {
      block.descendants(node => {
        if (node.marks.some(mark => mark.type.name === "footnoteReference" && String(mark.attrs.id) === id)) {
          result = position;
          return false;
        }
        return true;
      });
    }
  });
  return result;
}
