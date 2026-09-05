import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { bindEdgeSwipe } from "../lib/edge-swipe";

export function useMobileViewport() {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 768px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

/** Shared modal behavior for both mobile edges, without moving desktop sidebars. */
export function useEdgeDrawer(open: boolean, side: "left" | "right", panelRef: RefObject<HTMLElement>, backdropRef: RefObject<HTMLElement>, onClose: () => void) {
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!open || !panel) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.querySelector<HTMLElement>("[data-drawer-close]")?.focus({ preventScroll: true });
    const unbind = bindEdgeSwipe(window, (touch) => {
      if (!(touch.target instanceof Node) || (!panel.contains(touch.target) && !backdrop?.contains(touch.target))) return null;
      return { direction: side === "left" ? "left" : "right", run: () => close.current() };
    }, {
      withinPanel: true,
      swipeButtonSelector: "[data-drawer-swipe-item], .document-outline-link, .document-bookmark-item:not(.swipe-open) .document-bookmark-jump",
    });
    const keydown = (event: KeyboardEvent) => {
      // A sidebar command may open a separate modal (rename/create/settings).
      // Let that foreground dialog own its keyboard navigation and Escape.
      const foreground = document.activeElement?.closest("[role='dialog'], .dialog-overlay, .settings-panel");
      if (foreground && foreground !== panel && !panel.contains(foreground)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      } else if (event.key === "Tab") {
        const items = [...panel.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']")]
          .filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
        const first = items[0];
        const last = items[items.length - 1];
        if (!panel.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const preventScroll = (event: TouchEvent) => {
      if (event.target instanceof Node && backdrop?.contains(event.target) && event.cancelable) event.preventDefault();
    };
    // Run after the shared recognizer so backdrop swipes can still close it.
    window.addEventListener("touchmove", preventScroll, { passive: false });
    document.addEventListener("keydown", keydown, true);
    return () => {
      unbind();
      window.removeEventListener("touchmove", preventScroll);
      document.removeEventListener("keydown", keydown, true);
      if (panel.contains(document.activeElement) || document.activeElement === document.body) {
        if (previousFocus?.isConnected && !previousFocus.closest("[inert]")) previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open, side, panelRef, backdropRef]);
}
