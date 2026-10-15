import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Hover { toolbar: HTMLElement; range: Range; left: number; top: number }
/** Reuses actual host toolbar commands, selection guards and menus; no second editing implementation. */
export function SelectionHoverToolbar() {
  const [hover, setHover] = useState<Hover | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const active = useRef<Hover | null>(null);
  active.current = hover;
  useEffect(() => {
    let frame = 0, x = 0, y = 0, buttons = 0, hideTimer = 0;
    const clear = () => { window.clearTimeout(hideTimer); hideTimer = 0; };
    const hide = () => { clear();
      for (const button of active.current?.toolbar.querySelectorAll<HTMLButtonElement>("button[aria-expanded=true]") ?? []) if (!button.closest(".menu-dropdown-list")) button.click();
      setHover(null);
    };
    const update = () => {
      frame = 0;
      if (buttons || !window.matchMedia("(min-width: 769px) and (pointer: fine)").matches) return;
      const target = document.elementFromPoint(x, y);
      if (host.current?.contains(target) || target?.closest(".menu-dropdown-list:popover-open")) { clear(); return; }
      const selection = document.getSelection();
      const range = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : null;
      const owner = range?.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range?.commonAncestorContainer.parentElement;
      const editor = owner?.closest(".ProseMirror, .cm-content");
      const toolbar = editor?.closest(".note-editor, .markdown-document-view")?.querySelector<HTMLElement>(editor.classList.contains("cm-content") ? ".markdown-source-tools" : ".editor-menu");
      let inside = false;
      if (range && editor?.contains(target)) {
        const point = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(x, y);
        if (point) inside = range.isPointInRange(point.startContainer, point.startOffset);
        else {
          const caret = (document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }).caretPositionFromPoint?.(x, y);
          if (caret) inside = range.isPointInRange(caret.offsetNode, caret.offset);
        }
      }
      if (!inside || !range || !toolbar || toolbar.closest("[inert]")) {
        if (!hideTimer) hideTimer = window.setTimeout(hide, 160);
        return;
      }
      clear();
      const rect = range.getBoundingClientRect();
      const width = Math.min(900, window.innerWidth - 16);
      const next = { toolbar, range: range.cloneRange(), left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: rect.top >= 50 ? rect.top - 42 : rect.bottom + 4 };
      setHover(current => current?.toolbar === toolbar && current.left === next.left && current.top === next.top ? current : next);
    };
    const move = (event: PointerEvent) => { x = event.clientX; y = event.clientY; buttons = event.buttons; if (!frame) frame = requestAnimationFrame(update); };
    const selectionChanged = () => { if (document.getSelection()?.isCollapsed) hide(); };
    const scroll = (event: Event) => { if (!host.current?.contains(event.target as Node)) hide(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && active.current) { hide(); event.preventDefault(); event.stopPropagation(); } };
    document.addEventListener("pointermove", move); document.addEventListener("selectionchange", selectionChanged);
    window.addEventListener("scroll", scroll, true); window.addEventListener("resize", hide); document.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(frame); clear(); document.removeEventListener("pointermove", move); document.removeEventListener("selectionchange", selectionChanged); window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", hide); document.removeEventListener("keydown", key); };
  }, []);
  useEffect(() => {
    const container = host.current;
    if (!container || !hover) return;
    const refresh = () => {
      container.replaceChildren();
      for (const original of hover.toolbar.querySelectorAll<HTMLButtonElement>("button")) {
        if (original.closest(".menu-dropdown-list") || original.closest("[hidden]")) continue;
        const button = original.cloneNode(true) as HTMLButtonElement;
        button.removeAttribute("id"); button.removeAttribute("autofocus"); button.tabIndex = 0;
        button.classList.add("selection-hover-action");
        if (!button.getAttribute("aria-label") && button.title) button.setAttribute("aria-label", button.title);
        button.addEventListener("pointerdown", event => { if (event.button === 0) event.preventDefault(); });
        button.addEventListener("click", () => {
          if (!original.isConnected || original.disabled || hover.toolbar.closest("[inert]")) return;
          const selection = document.getSelection();
          if (hover.range.startContainer.isConnected && hover.range.endContainer.isConnected) { selection?.removeAllRanges(); selection?.addRange(hover.range); }
          original.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", button: 0 }));
          original.click();
        });
        container.append(button);
      }
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(hover.toolbar, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "aria-pressed", "aria-expanded", "class"] });
    return () => observer.disconnect();
  }, [hover]);
  return hover ? createPortal(<div ref={host} className="selection-hover-toolbar editor-menu toolbar-full toolbar-scrollable" role="toolbar" aria-label="选区编辑工具" style={{ left: hover.left, top: hover.top }} />, document.body) : null;
}
