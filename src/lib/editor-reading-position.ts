import type { Editor } from "@tiptap/core";

export interface RenderedReadingAnchor {
  position: number;
  offset: number;
  text: string;
  kind?: "block";
  nodeType?: string;
}

function viewportTop(root: HTMLElement): number {
  const rect = root.getBoundingClientRect();
  const sticky = root.querySelector<HTMLElement>(":scope > .note-editor-sticky");
  return sticky && getComputedStyle(sticky).position === "sticky"
    ? Math.max(rect.top, Math.min(rect.bottom, sticky.getBoundingClientRect().bottom))
    : rect.top;
}

/** Bounded hit testing, performed at persistence boundaries rather than per scroll frame. */
export function captureRenderedReadingAnchor(editor: Editor, root: HTMLElement): RenderedReadingAnchor | undefined {
  if (editor.isDestroyed || !root.isConnected || !root.clientHeight || !root.clientWidth) return;
  const top = viewportTop(root);
  const bounds = editor.view.dom.getBoundingClientRect();
  const x = Math.min(bounds.right - 1, bounds.left + 48);
  for (const offset of [1, 8, 24, 48]) {
    const position = editor.view.posAtCoords({ left: x, top: top + offset })?.pos;
    if (position === undefined || position < 0 || position > editor.state.doc.content.size) continue;
    const resolved = editor.state.doc.resolve(position);
    if (!resolved.parent.isTextblock) continue;
    const coords = editor.view.coordsAtPos(position);
    if (coords.bottom <= top || coords.top >= root.getBoundingClientRect().bottom) continue;
    return {
      position,
      offset: coords.top - top,
      text: editor.state.doc.textBetween(position, Math.min(position + 32, editor.state.doc.content.size), "\n"),
    };
  }
  // Hit testing may fail while the native window is being hidden, or when a
  // non-text NodeView fills the viewport. DOM geometry remains available.
  let fallback: RenderedReadingAnchor | undefined;
  editor.state.doc.forEach((node, position) => {
    if (fallback) return;
    const element = editor.view.nodeDOM(position);
    if (!(element instanceof HTMLElement)) return;
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0 || rect.bottom <= top || rect.top >= root.getBoundingClientRect().bottom) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(candidate) {
        if (candidate instanceof HTMLElement) {
          const bounds = candidate.getBoundingClientRect();
          return candidate.contentEditable === "false" || bounds.bottom <= top || bounds.top >= root.getBoundingClientRect().bottom
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        }
        return candidate.textContent?.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const bounds = range.getBoundingClientRect();
      if (!bounds.height || bounds.bottom <= top) continue;
      let low = 0;
      let high = textNode.textContent!.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        range.setStart(textNode, middle);
        range.setEnd(textNode, middle + 1);
        if (range.getBoundingClientRect().bottom <= top) low = middle + 1;
        else high = middle;
      }
      const textPosition = editor.view.posAtDOM(textNode, low);
      if (!editor.state.doc.resolve(textPosition).parent.isTextblock) continue;
      const coords = editor.view.coordsAtPos(textPosition);
      fallback = { position: textPosition, offset: coords.top - top,
        text: editor.state.doc.textBetween(textPosition, Math.min(textPosition + 32, editor.state.doc.content.size), "\n") };
      return;
    }
    fallback = { position, offset: rect.top - top, text: node.textContent.slice(0, 32), kind: "block", nodeType: node.type.name };
  });
  return fallback;
}

export function restoreRenderedReadingAnchor(editor: Editor, root: HTMLElement, anchor: RenderedReadingAnchor): boolean {
  if (editor.isDestroyed || anchor.position > editor.state.doc.content.size) return false;
  if (anchor.kind === "block") {
    const node = editor.state.doc.nodeAt(anchor.position);
    const element = editor.view.nodeDOM(anchor.position);
    if (!node || node.type.name !== anchor.nodeType || node.textContent.slice(0, 32) !== anchor.text
      || !(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.height) return false;
    const target = root.scrollTop + rect.top - viewportTop(root) - anchor.offset;
    root.scrollTop = target;
    return Math.abs(root.scrollTop - target) <= 1;
  }
  const text = editor.state.doc.textBetween(anchor.position, Math.min(anchor.position + 32, editor.state.doc.content.size), "\n");
  if (text !== anchor.text || !editor.state.doc.resolve(anchor.position).parent.isTextblock) return false;
  const coords = editor.view.coordsAtPos(anchor.position);
  // A folded/hidden text node has no usable line box; retain the pixel fallback.
  if (coords.bottom <= coords.top) return false;
  const target = root.scrollTop + coords.top - viewportTop(root) - anchor.offset;
  root.scrollTop = target;
  // A slow NodeView or temporarily clamped shell may prevent reaching this
  // anchor. Keep restoration pending instead of publishing the clamped value.
  return Math.abs(root.scrollTop - target) <= 1;
}
