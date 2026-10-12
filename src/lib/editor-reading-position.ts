import type { Editor } from "@tiptap/core";

export interface RenderedReadingAnchor {
  position: number;
  offset: number;
  text: string;
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
}

export function restoreRenderedReadingAnchor(editor: Editor, root: HTMLElement, anchor: RenderedReadingAnchor): boolean {
  if (editor.isDestroyed || anchor.position > editor.state.doc.content.size) return false;
  const text = editor.state.doc.textBetween(anchor.position, Math.min(anchor.position + 32, editor.state.doc.content.size), "\n");
  if (text !== anchor.text || !editor.state.doc.resolve(anchor.position).parent.isTextblock) return false;
  const coords = editor.view.coordsAtPos(anchor.position);
  // A folded/hidden text node has no usable line box; retain the pixel fallback.
  if (coords.bottom <= coords.top) return false;
  root.scrollTop += coords.top - viewportTop(root) - anchor.offset;
  return true;
}
