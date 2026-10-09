import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { Node as PMNode } from "@tiptap/pm/model";

type Bubble = { anchor: HTMLElement; text: string; kind: "footnote" | "link" };

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

/** Desktop previews share presentation; hovering never loads or opens the target. */
export function useDocumentHoverPreview(getDocument: () => PMNode | null) {
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!bubble || !previewRef.current) return;
    const rect = bubble.anchor.getBoundingClientRect();
    const popup = previewRef.current;
    const box = popup.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = (viewport?.offsetLeft ?? 0) + 8;
    const top = (viewport?.offsetTop ?? 0) + 8;
    const right = left + (viewport?.width ?? innerWidth) - 16;
    const bottom = top + (viewport?.height ?? innerHeight) - 16;
    popup.style.left = `${Math.max(left, Math.min(rect.left, right - box.width))}px`;
    popup.style.top = `${Math.max(top, Math.min(bottom - box.height, rect.bottom + box.height + 8 > bottom ? rect.top - box.height - 8 : rect.bottom + 8))}px`;
  }, [bubble]);
  useEffect(() => {
    if (!bubble) return;
    const clear = () => setBubble(null);
    const key = () => clear();
    window.addEventListener("resize", clear);
    window.addEventListener("blur", clear);
    document.addEventListener("scroll", clear, true);
    document.addEventListener("pointerdown", clear, true);
    document.addEventListener("keydown", key);
    window.visualViewport?.addEventListener("resize", clear);
    window.visualViewport?.addEventListener("scroll", clear);
    return () => {
      window.removeEventListener("resize", clear);
      window.removeEventListener("blur", clear);
      document.removeEventListener("scroll", clear, true);
      document.removeEventListener("pointerdown", clear, true);
      document.removeEventListener("keydown", key);
      window.visualViewport?.removeEventListener("resize", clear);
      window.visualViewport?.removeEventListener("scroll", clear);
    };
  }, [bubble]);
  const show = (target: EventTarget | null, root: HTMLElement) => {
    if (window.innerWidth < 768 || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const reference = target instanceof Element ? target.closest<HTMLElement>(".nr-footnote-reference") : null;
    const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
    const anchor = reference ?? link;
    if (!anchor || !root.contains(anchor) || link?.classList.contains("nr-footnote-backref")) return;
    const id = reference?.dataset.footnoteRef;
    const text = reference ? (id ? footnotePreviewText(getDocument(), id) : null) : link?.getAttribute("href");
    if (!text) return;
    setBubble(current => current && current.anchor === anchor && current.text === text
      ? current
      : { anchor, text, kind: reference ? "footnote" : "link" });
  };
  const hide = (target: EventTarget | null, related: EventTarget | null) => {
    const reference = target instanceof Element ? target.closest<HTMLElement>(".nr-footnote-reference, a[href]") : null;
    if (reference && related instanceof Node && reference.contains(related)) return;
    setBubble(null);
  };
  return {
    onPointerOver: (event: PointerEvent<HTMLElement>) => { if (event.pointerType !== "touch") show(event.target, event.currentTarget); },
    onPointerOut: (event: PointerEvent<HTMLElement>) => hide(event.target, event.relatedTarget),
    onFocusCapture: (event: FocusEvent<HTMLElement>) => show(event.target, event.currentTarget),
    onBlurCapture: (event: FocusEvent<HTMLElement>) => hide(event.target, event.relatedTarget),
    onScrollCapture: () => setBubble(null),
    preview: bubble && createPortal(<div ref={previewRef} className={`nr-footnote-hover-preview${bubble.kind === "link" ? " nr-link-hover-preview" : ""}`} role="tooltip">{bubble.text}</div>, document.body),
  };
}
