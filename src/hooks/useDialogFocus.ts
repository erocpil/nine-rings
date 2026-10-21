import { useLayoutEffect, useRef, type RefObject } from "react";

/** Keep Tab within a visible dialog and restore its trigger after dismissal. */
export function useDialogFocus(
  containerRef: RefObject<HTMLElement>,
  active: boolean,
  initialFocusRef: RefObject<HTMLElement>,
  restoreFocusRef?: RefObject<HTMLElement | null>,
  cycleAllControls = false,
) {
  const restoreFrameRef = useRef<number | null>(null);
  const previousFocusRef = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;
    // Strict Mode replays effects; a pending cleanup must not steal focus
    // from the still-open dialog (also applies to a rapid reopen).
    if (restoreFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
    }
    if (!container.contains(document.activeElement)) {
      previousFocusRef.current = document.activeElement;
    }
    const previous = previousFocusRef.current;
    // Capture this dialog's trigger before cleanup can observe a cleared or
    // reassigned ref (for example when another dialog is opened).
    const restoreTarget = restoreFocusRef?.current ?? previous;
    initialFocusRef.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(
        container.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled):not([type='hidden']), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex='0']",
        ),
      ).filter(
        (element) =>
          element.getClientRects().length > 0 &&
          !element.closest("[inert]") &&
          (!(element instanceof HTMLInputElement) ||
            element.type !== "radio" ||
            element.checked),
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      // Native WebKit Tab navigation can omit buttons unless full keyboard
      // access is enabled. Native plugin dialogs opt into explicit cycling.
      if (cycleAllControls) {
        event.preventDefault();
        const index = controls.indexOf(document.activeElement as HTMLElement);
        const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        controls[next].focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      event.stopPropagation();
    };
    container.addEventListener("keydown", keydown);
    return () => {
      container.removeEventListener("keydown", keydown);
      // Selecting an item can move focus to another editor/dialog. Preserve it.
      restoreFrameRef.current = window.requestAnimationFrame(() => {
        restoreFrameRef.current = null;
        const current = document.activeElement;
        if (
          current &&
          current !== document.body &&
          current !== document.documentElement &&
          !container.contains(current)
        )
          return;
        if (restoreTarget instanceof HTMLElement && restoreTarget.isConnected)
          restoreTarget.focus({ preventScroll: true });
      });
    };
  }, [active, containerRef, initialFocusRef, restoreFocusRef, cycleAllControls]);
}
