import { canRemoveRenderedLink, removeRenderedLink } from "../lib/rendered-link-editing";
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent as ReactPointerEvent } from "react";
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
export function useDocumentHoverPreview(getDocument: () => PMNode | null, root: HTMLElement | null = null) {
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = () => { if (hideTimer.current !== null) clearTimeout(hideTimer.current); hideTimer.current = null; };
  const clear = () => { cancelHide(); setBubble(null); };
  const deferHide = () => { cancelHide(); hideTimer.current = setTimeout(() => { hideTimer.current = null; setBubble(null); }, 180); };
  useEffect(() => () => { if (hideTimer.current !== null) clearTimeout(hideTimer.current); }, []);
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
    const clear = () => { if (hideTimer.current !== null) clearTimeout(hideTimer.current); hideTimer.current = null; setBubble(null); };
    const pointer = (event: Event) => { if (!previewRef.current?.contains(event.target as Node)) clear(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); clear(); }
      else if (event.key !== "Tab" && !previewRef.current?.contains(document.activeElement)) clear();
    };
    window.addEventListener("resize", clear);
    window.addEventListener("blur", clear);
    document.addEventListener("scroll", clear, true);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key, true);
    window.visualViewport?.addEventListener("resize", clear);
    window.visualViewport?.addEventListener("scroll", clear);
    return () => {
      window.removeEventListener("resize", clear);
      window.removeEventListener("blur", clear);
      document.removeEventListener("scroll", clear, true);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key, true);
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
    cancelHide();
    setBubble(current => current && current.anchor === anchor && current.text === text
      ? current
      : { anchor, text, kind: reference ? "footnote" : "link" });
  };
  const hide = (target: EventTarget | null, related: EventTarget | null) => {
    const reference = target instanceof Element ? target.closest<HTMLElement>(".nr-footnote-reference, a[href]") : null;
    if (related instanceof Node && (reference?.contains(related) || previewRef.current?.contains(related))) return;
    deferHide();
  };
  const nativeHandlers = useRef({ show, hide });
  nativeHandlers.current = { show, hide };
  useEffect(() => {
    if (!root) return;
    // React NodeViews are portals: their synthetic path can bypass EditorContent.
    // Delegate on the actual view DOM so nested quotes/flow blocks work too.
    const over = (event: PointerEvent) => { if (event.pointerType !== "touch") nativeHandlers.current.show(event.target, root); };
    const out = (event: PointerEvent) => nativeHandlers.current.hide(event.target, event.relatedTarget);
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerout", out);
    return () => { root.removeEventListener("pointerover", over); root.removeEventListener("pointerout", out); };
  }, [root]);
  const editableLink = bubble?.kind === "link" && bubble.anchor instanceof HTMLAnchorElement && canRemoveRenderedLink(bubble.anchor);
  return {
    onPointerOver: (event: ReactPointerEvent<HTMLElement>) => { if (event.pointerType !== "touch") show(event.target, event.currentTarget); },
    onPointerOut: (event: ReactPointerEvent<HTMLElement>) => hide(event.target, event.relatedTarget),
    onFocusCapture: (event: FocusEvent<HTMLElement>) => show(event.target, event.currentTarget),
    onBlurCapture: (event: FocusEvent<HTMLElement>) => hide(event.target, event.relatedTarget),
    onScrollCapture: clear,
    preview: bubble && createPortal(<div ref={previewRef}
      className={`nr-footnote-hover-preview${bubble.kind === "link" ? " nr-link-hover-preview" : ""}${editableLink ? " nr-link-hover-actions" : ""}`}
      role={editableLink ? "dialog" : "tooltip"} aria-label={editableLink ? "链接操作预览" : undefined}
      onPointerOver={event => { event.stopPropagation(); cancelHide(); }}
      onPointerOut={event => { event.stopPropagation(); if (!(event.relatedTarget instanceof Node && previewRef.current?.contains(event.relatedTarget))) deferHide(); }}
      onFocusCapture={cancelHide}
      onBlurCapture={event => { if (!(event.relatedTarget instanceof Node && previewRef.current?.contains(event.relatedTarget))) deferHide(); }}>
      <span className="nr-link-preview-address">{bubble.text}</span>
      {editableLink && <button type="button" onPointerDown={event => event.preventDefault()} onClick={() => {
        if (bubble.anchor instanceof HTMLAnchorElement) removeRenderedLink(bubble.anchor);
        clear();
      }}>移除链接</button>}
    </div>, document.body),
  };
}
