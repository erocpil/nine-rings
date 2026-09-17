import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

type Panel = "tree" | "list" | "reader";
interface Options {
  enabled: boolean;
  panel: Panel;
  hidden: boolean;
  resizing: boolean;
  openPanel: (panel: Panel, toggle?: boolean) => void;
  setHidden: (hidden: boolean) => void;
}

/** A hover preview is temporary; clicking pins it without changing the preference. */
export function useSidebarHoverPreview({
  enabled,
  panel,
  hidden,
  resizing,
  openPanel,
  setHidden,
}: Options) {
  const [pinned, setPinned] = useState(false);
  const pointerInside = useRef(false);
  const keyboardInside = useRef(false);
  const focusFrame = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const scheduleHide = useCallback(() => {
    cancel();
    if (!enabled || pinned || resizing) return;
    const check = () => {
      if (pointerInside.current) return;
      const root = document.getElementById("workspace-sidebar");
      const active = document.activeElement;
      const editing =
        root?.contains(active) &&
        (keyboardInside.current ||
          active?.matches(
            "input, textarea, select, iframe, [contenteditable=true]",
          ));
      // Native selects, nested menus/dialogs and focused reading frames own
      // the interaction until it finishes. Do not use window blur to dismiss.
      if (
        editing ||
        root?.querySelector(".doc-context-menu, [role=menu]") ||
        document.querySelector("[role=dialog][aria-modal=true]")
      ) {
        timer.current = setTimeout(check, 180);
      } else {
        keyboardInside.current = false;
        setHidden(true);
      }
    };
    timer.current = setTimeout(check, 180);
  }, [cancel, enabled, pinned, resizing, setHidden]);
  useEffect(() => {
    cancel();
    setPinned(false);
    if (enabled) setHidden(true);
    return () => {
      cancel();
      cancelAnimationFrame(focusFrame.current);
    };
  }, [enabled, cancel, setHidden]);
  useEffect(() => {
    if (hidden) {
      setPinned(false);
      keyboardInside.current = false;
    }
  }, [hidden]);
  useEffect(() => {
    if (enabled && !pinned && !hidden && !resizing && !pointerInside.current) {
      scheduleHide();
    }
    return cancel;
  }, [enabled, pinned, hidden, resizing, cancel, scheduleHide]);
  useEffect(() => {
    if (!enabled || hidden || pinned) return;
    // WebKit can lose a boundary leave while a lazy panel/transition changes
    // hit testing. An actual move over the main area also ends the preview.
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !(event.target instanceof Element))
        return;
      if (
        event.target.closest(
          "#workspace-sidebar, [data-sidebar-panel], .sidebar-divider",
        )
      )
        return;
      if (pointerInside.current) {
        pointerInside.current = false;
        scheduleHide();
      }
    };
    document.addEventListener("pointermove", move, { passive: true });
    return () => document.removeEventListener("pointermove", move);
  }, [enabled, hidden, pinned, scheduleHide]);
  const dismiss = useCallback(() => {
    cancel();
    cancelAnimationFrame(focusFrame.current);
    keyboardInside.current = false;
    setPinned(false);
    setHidden(true);
    document
      .querySelector<HTMLElement>(`[data-sidebar-panel="${panel}"]`)
      ?.focus({ preventScroll: true });
  }, [cancel, panel, setHidden]);
  useEffect(() => {
    if (!enabled || hidden) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        document.querySelector(
          ".doc-context-menu, [role=menu], [role=dialog][aria-modal=true]",
        )
      )
        return;
      event.preventDefault();
      dismiss();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [enabled, hidden, dismiss]);

  const enterButton = (next: Panel, pointerType: string) => {
    pointerInside.current = true;
    cancel();
    if (!enabled || pinned || pointerType === "touch") return;
    timer.current = setTimeout(() => openPanel(next), 120);
  };
  const leave = () => {
    pointerInside.current = false;
    // Bridge the small gap between the button, splitter and panel.
    scheduleHide();
  };
  const keyDown = (next: Panel, event: KeyboardEvent<HTMLButtonElement>) => {
    if (!enabled || !["ArrowRight", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    cancel();
    keyboardInside.current = true;
    openPanel(next);
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      const root = document.getElementById("workspace-sidebar");
      const first = [
        ...(root?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ) ?? []),
      ].find(
        (el) => el.getClientRects().length && !el.closest("[hidden], [inert]"),
      );
      (first ?? root)?.focus({ preventScroll: true });
    });
  };
  const click = (next: Panel) => {
    cancel();
    if (!enabled) {
      openPanel(next, true);
      return;
    }
    if (pinned && !hidden && panel === next) {
      setPinned(false);
      setHidden(true);
    } else {
      setPinned(true);
      openPanel(next);
    }
  };
  const enterPanel = () => {
    pointerInside.current = true;
    cancel();
  };
  return { pinned, enterButton, enterPanel, leave, click, keyDown, dismiss };
}
