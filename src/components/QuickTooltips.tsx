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
    const scrollViewport = hint.target
      .closest<HTMLElement>(".note-editor-scroll")
      ?.getBoundingClientRect();
    const minTop = Math.max(8, (scrollViewport?.top ?? 0) + (scrollViewport ? 8 : 0));
    const maxBottom = Math.min(
      window.innerHeight - 8,
      scrollViewport?.bottom !== undefined
        ? scrollViewport.bottom - 8
        : window.innerHeight - 8,
    );
    const desiredLeft =
      hint.target.dataset.tooltipAlign === "start"
        ? box.left
        : box.left + (box.width - popup.width) / 2;
    const left = Math.max(
      8,
      Math.min(desiredLeft, window.innerWidth - popup.width - 8),
    );
    const above = box.bottom + 6 + popup.height > maxBottom;
    const maxTop = Math.max(minTop, maxBottom - popup.height);
    const desiredTop = above
      ? box.top - popup.height - 6
      : box.bottom + 6;
    // A gutter control can move below the viewport after it triggered the hint
    // (for example, when the last block is clipped by the editor viewport).
    // Flip first, then clamp the tooltip itself so it cannot be cut off at the
    // window edge even when the anchor is partially or entirely outside it.
    const top = Math.max(minTop, Math.min(desiredTop, maxTop));
    if (
      Math.abs(hint.left - left) > 0.5 ||
      Math.abs(hint.top - top) > 0.5
    )
      setHint({ ...hint, left, top });
  }, [hint]);
  useEffect(() => {
    let target: HTMLElement | null = null;
    let title = "";
    let pathTarget = false;
    let describedBy: string | null = null;
    let ariaLabel: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    let scrollingUntil = 0;
    let pointer: { x: number; y: number } | null = null;
    const clear = () => {
      clearTimeout(timer);
      if (target) {
        if (!pathTarget && !target.hasAttribute("title")) target.setAttribute("title", title);
        if (ariaLabel === null) target.removeAttribute("aria-label");
        else target.setAttribute("aria-label", ariaLabel);
        if (describedBy === null) target.removeAttribute("aria-describedby");
        else target.setAttribute("aria-describedby", describedBy);
      }
      target = null;
      setHint(null);
    };
    const enter = (event: PointerEvent | FocusEvent, candidate?: HTMLElement) => {
      if (event instanceof PointerEvent && event.pointerType === "mouse") pointer = { x: event.clientX, y: event.clientY };
      if (event instanceof PointerEvent && event.pointerType !== "mouse")
        return;
      if (target?.contains(event.target as Node)) return;
      const element = candidate ?? (
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(
              "[data-tooltip-path], button[title], select[title], [role=button][title]",
            )
          : null);
      if (
        element === target ||
        element?.contains((event as FocusEvent).relatedTarget as Node | null)
      )
        return;
      clear();
      if (!element || !(element.dataset.tooltipPath || element.title).trim() || element.getAttribute("aria-expanded") === "true" || (element.dataset.tooltipPath && Date.now() < scrollingUntil)) return;
      const suppressDocumentPanelHint =
        // Hover previews provide their own context; click-only panels need a hint.
        ["outline", "bookmark"].includes(element.dataset.documentPanelTrigger ?? "") &&
        element.dataset.pinned !== "true";
      // Touch/click focus must not leave a hover hint covering mobile controls.
      if (event.type === "focusin" && !element.matches(":focus-visible"))
        return;
      target = element;
      pathTarget = Boolean(element.dataset.tooltipPath);
      title = element.dataset.tooltipPath || element.title;
      describedBy = element.getAttribute("aria-describedby");
      ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel === null && !element.textContent?.trim())
        element.setAttribute("aria-label", title);
      // Suppress the browser's slower, duplicate tooltip while retaining the
      // original title when the pointer leaves the control.
      if (!element.dataset.tooltipPath) element.removeAttribute("title");
      if (suppressDocumentPanelHint) return;
      const show = () => {
        if (!element.isConnected || element.getAttribute("aria-expanded") === "true" || (pathTarget && !element.dataset.tooltipPath)) {
          clear();
          return;
        }
        const box = element.getBoundingClientRect();
        element.setAttribute(
          "aria-describedby",
          [describedBy, id].filter(Boolean).join(" "),
        );
        setHint({
          text: element.dataset.tooltipPath || title,
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
    const move = (event: PointerEvent) => { if (event.pointerType === "mouse") pointer = { x: event.clientX, y: event.clientY }; };
    const dismiss = () => { clearTimeout(scrollTimer); clear(); };
    const scroll = (event: Event) => {
      clear(); clearTimeout(scrollTimer);
      if (!(event.target instanceof Element) || !event.target.closest(".file-browser-list")) return;
      scrollingUntil = Date.now() + 240;
      scrollTimer = setTimeout(() => {
        if (!pointer || document.querySelector("[role='menu'], .workspace-dialog-backdrop")) return;
        const element = document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>("[data-tooltip-path]");
        if (element) enter(new PointerEvent("pointerover", { pointerType: "mouse", clientX: pointer.x, clientY: pointer.y }), element);
      }, 260);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("wheel", scroll, { capture: true, passive: true });
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", enter);
    document.addEventListener("focusout", leave);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      dismiss();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("wheel", scroll, true);
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("focusout", leave);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismiss, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [id]);
  if (!hint) return null;
  // A tooltip portaled into a modal dialog must remain in the dialog's top
  // layer. Since the dialog is transformed to center it, fixed-position
  // coordinates inside it are relative to the dialog, not the viewport.
  const dialog =
    hint.host instanceof HTMLElement && hint.host.tagName === "DIALOG"
      ? hint.host
      : null;
  const dialogBounds = dialog?.getBoundingClientRect();
  const dialogStyle = dialog ? getComputedStyle(dialog) : null;
  const left = dialogBounds
    ? hint.left - dialogBounds.left - Number.parseFloat(dialogStyle?.borderLeftWidth ?? "0")
    : hint.left;
  const top = dialogBounds
    ? hint.top - dialogBounds.top - Number.parseFloat(dialogStyle?.borderTopWidth ?? "0")
    : hint.top;
  return createPortal(
        <div
          ref={tooltipRef}
          id={id}
          role="tooltip"
          className={`quick-tooltip${hint.target.dataset.tooltipPath ? " quick-tooltip-path" : ""}`}
          style={{
            left,
            top,
          }}
        >
          {hint.text}
        </div>,
        hint.host,
      );
}
