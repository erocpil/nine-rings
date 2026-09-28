import { useState, type FocusEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { Node as PMNode } from "@tiptap/pm/model";

type Bubble = { id: string; text: string; left: number; top: number };

export function footnotePreviewText(doc: PMNode | null, id: string): string | null {
  if (!doc) return null;
  let text: string | null = null;
  doc.forEach(block => {
    if (block.type.name !== "footnotes") return;
    block.forEach(definition => {
      if (String(definition.attrs.id) === id) text = definition.textContent.trim();
    });
  });
  return text;
}

/** A desktop-only preview; the footnote link remains usable on every platform. */
export function useFootnoteHoverPreview(getDocument: () => PMNode | null) {
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const show = (target: EventTarget | null, root: HTMLElement) => {
    if (window.innerWidth < 768 || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const reference = target instanceof Element ? target.closest<HTMLElement>(".nr-footnote-reference") : null;
    if (!reference || !root.contains(reference)) return;
    const id = reference.dataset.footnoteRef;
    const text = id ? footnotePreviewText(getDocument(), id) : null;
    if (!id || !text) return;
    const rect = reference.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 328));
    setBubble(current => current && current.id === id && current.left === left && current.top === rect.bottom + 8
      ? current
      : { id, text, left, top: rect.bottom + 8 });
  };
  const hide = (target: EventTarget | null, related: EventTarget | null) => {
    const reference = target instanceof Element ? target.closest<HTMLElement>(".nr-footnote-reference") : null;
    if (reference && related instanceof Node && reference.contains(related)) return;
    setBubble(null);
  };
  return {
    onPointerOver: (event: PointerEvent<HTMLElement>) => { if (event.pointerType !== "touch") show(event.target, event.currentTarget); },
    onPointerOut: (event: PointerEvent<HTMLElement>) => hide(event.target, event.relatedTarget),
    onFocusCapture: (event: FocusEvent<HTMLElement>) => show(event.target, event.currentTarget),
    onBlurCapture: (event: FocusEvent<HTMLElement>) => hide(event.target, event.relatedTarget),
    onScrollCapture: () => setBubble(null),
    preview: bubble && createPortal(<div className="nr-footnote-hover-preview" role="tooltip" style={{ left: bubble.left, top: bubble.top }}>{bubble.text}</div>, document.body),
  };
}
