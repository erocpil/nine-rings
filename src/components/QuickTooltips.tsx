import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

/** Delegate hover hints so newly opened toolbars/settings share the same short delay. */
export function QuickTooltips() {
  const id = useId();
  const [hint, setHint] = useState<{
    text: string;
    left: number;
    top: number;
    above: boolean;
    host: Element;
  } | null>(null);
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
      const suppressDocumentPanelHint = element.matches("[data-document-panel-trigger]") && element.dataset.pinned !== "true";
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
        const above = box.bottom + 64 > window.innerHeight;
        element.setAttribute(
          "aria-describedby",
          [describedBy, id].filter(Boolean).join(" "),
        );
        const estimatedWidth = Math.min(320, Math.max(44, Array.from(title).length * 12 + 18));
        setHint({
          text: title,
          left: Math.max(8, Math.min(box.left + (box.width - estimatedWidth) / 2, window.innerWidth - estimatedWidth - 8)),
          top: above ? box.top - 6 : box.bottom + 6,
          above,
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
          id={id}
          role="tooltip"
          className="quick-tooltip"
          style={{
            left: hint.left,
            top: hint.top,
            transform: hint.above ? "translateY(-100%)" : undefined,
          }}
        >
          {hint.text}
        </div>,
        hint.host,
      )
    : null;
}
