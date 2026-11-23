import { watchWindowHoverDismiss } from "../lib/window-hover-lifecycle";
import { useEffect, useId, useState, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

/** Delegate hover hints so newly opened toolbars/settings share the same short delay. */
export function QuickTooltips() {
  const id = useId();
  const [hint, setHint] = useState<{
    text: string;
    detail?: string;
    left: number;
    top: number;
    host: HTMLElement;
    target: HTMLElement;
  } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = tooltipRef.current;
    if (!hint || !element) return;
    const box = hint.target.getBoundingClientRect(),
      popup = element.getBoundingClientRect();
    // Keep modal hints in the modal's layer and visible client area. Native
    // dialogs can also scroll, so translate viewport coordinates after clamping.
    const overlay = hint.host === document.body ? null : hint.host;
    const overlayBounds = overlay?.getBoundingClientRect();
    const originLeft = overlayBounds ? overlayBounds.left + hint.host.clientLeft : 0;
    const originTop = overlayBounds ? overlayBounds.top + hint.host.clientTop : 0;
    const scrollViewport = hint.target
      .closest<HTMLElement>(".note-editor-scroll")
      ?.getBoundingClientRect();
    const minTop = Math.max(0, originTop, scrollViewport?.top ?? 0) + 8;
    const maxBottom = Math.min(
      window.innerHeight,
      overlay ? originTop + overlay.clientHeight : Infinity,
      scrollViewport?.bottom ?? Infinity,
    ) - 8;
    // File rows span all metadata columns. Anchor their path hint to the name
    // text (after the icon), while retaining the row as the hover owner.
    const name = hint.target.dataset.tooltipPath
      ? hint.target.querySelector<HTMLElement>(".file-browser-name-text")
      : null;
    const desiredLeft = name
      ? name.getBoundingClientRect().left
      : hint.target.dataset.tooltipAlign === "start"
        ? box.left
        : box.left + (box.width - popup.width) / 2;
    const minLeft = Math.max(0, originLeft) + 8;
    const maxRight = Math.min(window.innerWidth, overlay ? originLeft + overlay.clientWidth : Infinity) - 8;
    const left = Math.max(minLeft, Math.min(desiredLeft, maxRight - popup.width)) - originLeft + (overlay?.scrollLeft ?? 0);
    const gap = hint.detail ? 4 : 6;
    const above = box.bottom + gap + popup.height > maxBottom;
    const maxTop = Math.max(minTop, maxBottom - popup.height);
    const desiredTop = above
      ? box.top - popup.height - gap
      : box.bottom + gap;
    // A gutter control can move below the viewport after it triggered the hint
    // (for example, when the last block is clipped by the editor viewport).
    // Flip first, then clamp the tooltip itself so it cannot be cut off at the
    // window edge even when the anchor is partially or entirely outside it.
    const top = Math.max(minTop, Math.min(desiredTop, maxTop)) - originTop + (overlay?.scrollTop ?? 0);
    if (
      Math.abs(hint.left - left) > 0.5 ||
      Math.abs(hint.top - top) > 0.5
    )
      setHint({ ...hint, left, top });
  }, [hint]);
  useEffect(() => {
    let target: HTMLElement | null = null;
    let title = "";
    let titleRemoved = false;
    let describedBy: string | null = null;
    let ariaLabel: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    let scrollingUntil = 0;
    let pointer: { x: number; y: number } | null = null;
    const clear = () => {
      clearTimeout(timer);
      if (target) {
        if (titleRemoved && !target.hasAttribute("title")) target.setAttribute("title", title);
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
              "[data-tooltip-label], [data-tooltip-path], button[title], select[title], [role=button][title]",
            )
          : null);
      if (
        element === target ||
        element?.contains((event as FocusEvent).relatedTarget as Node | null)
      )
        return;
      clear();
      if (!element || !(element.dataset.tooltipLabel || element.dataset.tooltipPath || element.title).trim() || (element.getAttribute("aria-expanded") === "true" && element.dataset.tooltipAlways !== "true") || (element.dataset.tooltipPath && Date.now() < scrollingUntil)) return;
      const suppressDocumentPanelHint =
        // Hover previews provide their own context; click-only panels need a hint.
        ["outline", "bookmark"].includes(element.dataset.documentPanelTrigger ?? "") &&
        element.dataset.pinned !== "true";
      // Touch/click focus must not leave a hover hint covering mobile controls.
      if (event.type === "focusin" && !element.matches(":focus-visible"))
        return;
      target = element;
      const pathTarget = Boolean(element.dataset.tooltipPath);
      const detailTarget = Boolean(element.dataset.tooltipLabel);
      titleRemoved = !pathTarget && !detailTarget;
      title = element.title;
      describedBy = element.getAttribute("aria-describedby");
      ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel === null && !element.textContent?.trim())
        element.setAttribute("aria-label", element.dataset.tooltipLabel || element.dataset.tooltipPath || title);
      // Suppress the browser's slower, duplicate tooltip while retaining the
      // original title when the pointer leaves the control.
      if (titleRemoved) element.removeAttribute("title");
      if (suppressDocumentPanelHint) return;
      const show = () => {
        if (!element.isConnected || (element.getAttribute("aria-expanded") === "true" && element.dataset.tooltipAlways !== "true") ||
            (pathTarget && !element.dataset.tooltipPath) || (detailTarget && !element.dataset.tooltipLabel)) {
          clear();
          return;
        }
        element.setAttribute(
          "aria-describedby",
          [describedBy, id].filter(Boolean).join(" "),
        );
        setHint({
          text: element.dataset.tooltipLabel || element.dataset.tooltipPath || title,
          detail: element.dataset.tooltipDetail,
          target: element,
          // Measure before paint; no character-width estimate for multiline hints.
          left: 0,
          top: 0,
          host: element.closest<HTMLElement>("dialog[open], .workspace-dialog-backdrop") ?? document.body,
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
    const closeDialog = (event: Event) => {
      if (target?.closest("dialog") === event.target) dismiss();
    };
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
    document.addEventListener("close", closeDialog, true);
    document.addEventListener("scroll", scroll, true);
    const stopWindowDismiss = watchWindowHoverDismiss(dismiss);
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
      document.removeEventListener("close", closeDialog, true);
      document.removeEventListener("scroll", scroll, true);
      stopWindowDismiss();
      window.removeEventListener("resize", dismiss);
    };
  }, [id]);
  if (!hint) return null;
  const inDialog = hint.host !== document.body;
  return createPortal(
        <div
          ref={tooltipRef}
          id={id}
          role="tooltip"
          className={`quick-tooltip${inDialog ? " quick-tooltip-in-dialog" : ""}${hint.target.dataset.tooltipPath ? " quick-tooltip-path" : ""}${hint.detail ? " quick-tooltip-detailed" : ""}`}
          style={{
            left: hint.left,
            top: hint.top,
          }}
        >
          {hint.detail ? <><strong>{hint.text}</strong><span>{hint.detail}</span></> : hint.text}
        </div>,
        hint.host,
      );
}
