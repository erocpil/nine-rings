import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { readDesktopSidebarState, saveDesktopSidebarState, type DesktopSidebarState } from "../lib/desktop-sidebar-state";
type Panel = import("../lib/desktop-sidebar-state").DesktopSidebarPanel;
interface Options {
  enabled: boolean;
  panel: Panel;
  hidden: boolean;
  resizing: boolean;
  openPanel: (panel: Panel, toggle?: boolean, width?: number) => void;
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
  const [pinned, setPinned] = useState(() => readDesktopSidebarState().pinned);
  const openPanelRef = useRef(openPanel);
  openPanelRef.current = openPanel;
  const previousHidden = useRef(hidden);
  const pointerInside = useRef(false);
  const keyboardInside = useRef(false);
  const focusFrame = useRef(0);
  const cancelFocusEntry = useRef<(() => void) | null>(null);
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
      // Keep the requested panel available while keyboard focus owns it.
      // Slow WebKit layout can outlast the hover dismissal delay.
      if (cancelFocusEntry.current) {
        timer.current = setTimeout(check, 180);
        return;
      }
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
        document.querySelector(".doc-context-menu[data-sidebar-owned], [role=menu][data-sidebar-owned], .document-filter-options[data-sidebar-owned]") ||
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
    if (enabled) {
      const saved = readDesktopSidebarState();
      setPinned(saved.pinned && !saved.hidden);
      if (saved.pinned && !saved.hidden) openPanelRef.current(saved.panel);
      else setHidden(true);
    }
    return () => {
      cancel();
      cancelAnimationFrame(focusFrame.current);
      cancelFocusEntry.current?.();
    };
  }, [enabled, cancel, setHidden]);
  useEffect(() => {
    const closed = hidden && !previousHidden.current;
    previousHidden.current = hidden;
    if (enabled && closed && pinned) {
      setPinned(false);
      saveDesktopSidebarState({ hidden: true, pinned: false });
      keyboardInside.current = false;
    }
  }, [enabled, hidden, pinned]);
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
          "#workspace-sidebar, [data-sidebar-panel], [data-sidebar-owned], .sidebar-divider",
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
    cancelFocusEntry.current?.();
    keyboardInside.current = false;
    setPinned(false);
    saveDesktopSidebarState({ ...(pinned ? { panel } : {}), hidden: true, pinned: false });
    setHidden(true);
    document
      .querySelector<HTMLElement>(`[data-sidebar-panel="${panel}"]`)
      ?.focus({ preventScroll: true });
  }, [cancel, panel, pinned, setHidden]);
  useEffect(() => {
    if (!enabled || hidden) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        document.querySelector(
          ".doc-context-menu, .document-filter-options[data-sidebar-owned], [role=menu], [role=dialog], dialog[open], [aria-modal=true], .editor-find-bar, .cm-panels",
        )
      )
        return;
      if (event.target instanceof Element && event.target.closest(".vim-mode-enabled")) return;
      event.preventDefault();
      dismiss();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
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
    cancelFocusEntry.current?.();
    keyboardInside.current = true;
    const finishEntry = () => {
      focusObserver.disconnect();
      document.removeEventListener("pointerdown", interruptEntry, true);
      document.removeEventListener("keydown", interruptEntry, true);
      document.removeEventListener("focusin", reclaimFocus, true);
      document.removeEventListener("focusout", retryFocus, true);
      cancelFocusEntry.current = null;
    };
    const interruptEntry = () => {
      keyboardInside.current = false;
      cancelAnimationFrame(focusFrame.current);
      finishEntry();
    };
    cancelFocusEntry.current = interruptEntry;
    document.addEventListener("pointerdown", interruptEntry, true);
    document.addEventListener("keydown", interruptEntry, true);
    const focusPanel = () => {
      if (!keyboardInside.current) { finishEntry(); return; }
      const root = document.getElementById("workspace-sidebar");
      if (root?.contains(document.activeElement)) return;
      // Opening the panel can race a delayed editor autofocus in WebKit.
      // Genuine user input interrupts entry; incidental focus changes do not.
      // Opening can commit after the first animation frame on a busy page.
      // Native focus silently fails while the panel is still inert/hidden.
      if (root && !root.closest("[inert]") && !root.classList.contains("sidebar-hidden")) {
        const first = [
          ...root.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
          ),
        ].find(
          (el) => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest('[hidden], [inert], [aria-hidden="true"]');
          },
        );
        (first ?? root).focus({ preventScroll: true });
        // Some WebKit controls reject focus while layout/inert is settling.
        // The panel itself is an explicit tabindex=-1 fallback.
        if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
        // Keep ownership after entry too: a late editor autofocus can arrive
        // after this frame. The next real pointer/key input releases it.
        if (root.contains(document.activeElement)) return;
      }
      // Readiness, not a wall-clock deadline, owns entry. Slow startup/layout
      // can exceed a second; real input, dismissal, restore and unmount cancel.
      focusFrame.current = requestAnimationFrame(focusPanel);
    };
    const reclaimFocus = () => {
      const root = document.getElementById("workspace-sidebar");
      if (!keyboardInside.current || root?.contains(document.activeElement)) return;
      // An application modal can take focus deliberately without a pointer.
      if (document.activeElement instanceof Element && document.activeElement.closest('[role="dialog"][aria-modal="true"]')) {
        interruptEntry();
        return;
      }
      cancelAnimationFrame(focusFrame.current);
      focusFrame.current = requestAnimationFrame(focusPanel);
    };
    const retryFocus = () => {
      if (!keyboardInside.current) return;
      // A temporary inert ancestor can blur to body without a new focusin.
      cancelAnimationFrame(focusFrame.current);
      focusFrame.current = requestAnimationFrame(focusPanel);
    };
    document.addEventListener("focusin", reclaimFocus, true);
    document.addEventListener("focusout", retryFocus, true);
    const focusObserver = new MutationObserver(() => {
      if (!document.getElementById("workspace-sidebar")?.contains(document.activeElement)) retryFocus();
    });
    // Removing a focused control need not emit focusout. Observe panel content
    // and ancestor inert changes only while this keyboard request owns focus.
    const root = document.getElementById("workspace-sidebar");
    for (let element = root; element; element = element.parentElement) {
      focusObserver.observe(element, { childList: element === root, subtree: element === root, attributes: true, attributeFilter: ["inert"] });
    }
    focusFrame.current = requestAnimationFrame(focusPanel);
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
      saveDesktopSidebarState({ panel: next, hidden: true, pinned: false });
    } else {
      setPinned(true);
      openPanel(next);
      saveDesktopSidebarState({ panel: next, hidden: false, pinned: true });
    }
  };
  const enterPanel = () => {
    pointerInside.current = true;
    cancel();
  };
  // Home navigation restores a complete layout, including the live pin state.
  // Storage alone cannot cancel a pending preview or keep the restored pane open.
  const restore = (state: DesktopSidebarState, width?: number) => {
    cancelFocusEntry.current?.();
    cancel();
    cancelAnimationFrame(focusFrame.current);
    pointerInside.current = false;
    keyboardInside.current = false;
    previousHidden.current = state.hidden;
    setPinned(state.pinned && !state.hidden);
    saveDesktopSidebarState(state);
    if (!state.hidden) openPanel(state.panel, false, width);
    setHidden(state.hidden);
  };
  return { pinned, enterButton, enterPanel, leave, click, keyDown, dismiss, restore };
}
