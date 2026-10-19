import { useEffect, useId, useState, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

/** Delegate hover hints so newly opened toolbars/settings share the same short delay. */
export function QuickTooltips() {
  const id = useId();
  const [hint, setHint] = useState<{
    text: string;
    left: number;
    top: number;
    host: Element;
    target: HTMLElement;
  } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = tooltipRef.current;
    if (!hint || !element) return;
    const box = hint.target.getBoundingClientRect(),
      popup = element.getBoundingClientRect();
    const desiredLeft =
      hint.target.dataset.tooltipAlign === "start"
        ? box.left
        : box.left + (box.width - popup.width) / 2;
    const left = Math.max(
      8,
      Math.min(desiredLeft, window.innerWidth - popup.width - 8),
    );
    const above = box.bottom + 6 + popup.height > window.innerHeight - 8;
    const maxTop = Math.max(8, window.innerHeight - popup.height - 8);
    const desiredTop = above
      ? box.top - popup.height - 6
      : box.bottom + 6;
    // A gutter control can move below the viewport after it triggered the hint
    // (for example, when the last block is clipped by the editor viewport).
    // Flip first, then clamp the tooltip itself so it cannot be cut off at the
    // window edge even when the anchor is partially or entirely outside it.
    const top = Math.max(8, Math.min(desiredTop, maxTop));
    if (
      Math.abs(hint.left - left) > 0.5 ||
      Math.abs(hint.top - top) > 0.5
    )
      setHint({ ...hint, left, top });
  }, [hint]);
  useEffect(() => {
    let target: HTMLElement | null = null;
    let title = "";
    let describedBy: string | null = null;
    let ariaLabel: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      clearTimeout(timer);
      if (target) {
        if (!target.hasAttribute("title")) target.setAttribute("title", title);
        if (ariaLabel === null) target.removeAttribute("aria-label");
        else target.setAttribute("aria-label", ariaLabel);
        if (describedBy === null) target.removeAttribute("aria-describedby");
        else target.setAttribute("aria-describedby", describedBy);
      }
      target = null;
      setHint(null);
    };
    const enter = (event: PointerEvent | FocusEvent) => {
      if (event instanceof PointerEvent && event.pointerType !== "mouse")
        return;
      if (target?.contains(event.target as Node)) return;
      const element =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(
              "button[title], select[title], [role=button][title]",
            )
          : null;
      if (
        element === target ||
        element?.contains((event as FocusEvent).relatedTarget as Node | null)
      )
        return;
      clear();
      if (!element || !element.title.trim()) return;
      const suppressDocumentPanelHint =
        element.matches("[data-document-panel-trigger]") &&
        element.dataset.pinned !== "true";
      // Touch/click focus must not leave a hover hint covering mobile controls.
      if (event.type === "focusin" && !element.matches(":focus-visible"))
        return;
      target = element;
      title = element.title;
      describedBy = element.getAttribute("aria-describedby");
      ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel === null && !element.textContent?.trim())
        element.setAttribute("aria-label", title);
      // Suppress the browser's slower, duplicate tooltip while retaining the
      // original title when the pointer leaves the control.
      element.removeAttribute("title");
      if (suppressDocumentPanelHint) return;
      const show = () => {
        if (!element.isConnected) {
          clear();
          return;
        }
        const box = element.getBoundingClientRect();
        element.setAttribute(
          "aria-describedby",
          [describedBy, id].filter(Boolean).join(" "),
        );
        setHint({
          text: title,
          target: element,
          // Measure before paint; no character-width estimate for multiline hints.
          left: 8,
          top: box.bottom + 6,
          host: element.closest("dialog[open]") ?? document.body,
        });
      };
      timer = setTimeout(show, event.type === "focusin" ? 0 : 120);
    };
    const leave = (event: MouseEvent | FocusEvent) => {
      if (
        target?.contains(event.target as Node) &&
        !target.contains(event.relatedTarget as Node | null)
      )
        clear();
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", enter);
    document.addEventListener("focusout", leave);
    document.addEventListener("pointerdown", clear, true);
    document.addEventListener("keydown", clear, true);
    document.addEventListener("scroll", clear, true);
    window.addEventListener("blur", clear);
    window.addEventListener("resize", clear);
    return () => {
      clear();
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("focusout", leave);
      document.removeEventListener("pointerdown", clear, true);
      document.removeEventListener("keydown", clear, true);
      document.removeEventListener("scroll", clear, true);
      window.removeEventListener("blur", clear);
      window.removeEventListener("resize", clear);
    };
  }, [id]);
  return hint
    ? createPortal(
        <div
          ref={tooltipRef}
          id={id}
          role="tooltip"
          className="quick-tooltip"
          style={{
            left: hint.left,
            top: hint.top,
          }}
        >
          {hint.text}
        </div>,
        hint.host,
      )
    : null;
}
