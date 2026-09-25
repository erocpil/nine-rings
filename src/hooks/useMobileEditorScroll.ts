import { MobileInputSession } from "../lib/mobile-input-session";
import { useEffect, type RefObject } from "react";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { Transaction } from "@tiptap/pm/state";
import { MOBILE_VIEWPORT_QUERY } from "./useEdgeDrawer";
import { EDITOR_NAVIGATION_EVENT } from "./useEditorScrollPersistence";

const scrollHandlers = new WeakMap<EditorView, () => boolean>();

/** Use ProseMirror's public scroll hook, including its focus recovery path. */
export function handleMobileEditorScroll(view: EditorView): boolean {
  return scrollHandlers.get(view)?.() ?? false;
}

/**
 * Touch selection is native. Focus/viewport events may precede its selection
 * transaction, so they must never reveal the old model caret. Only keyboard
 * shrink and explicit editing/navigation requests may reveal a confirmed caret.
 */
export function useMobileEditorScroll(editor: Editor | null, scrollRef: RefObject<HTMLElement>, readonly = false) {
  useEffect(() => {
    const root = scrollRef.current;
    const viewport = window.visualViewport;
    if (!editor || !root || !viewport || readonly) return;
    const view = editor.view;
    const mobile = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    let frame = 0;
    let layoutFrame = 0;
    const session = new MobileInputSession();
    let lastHeight = viewport.height;
    let waitingForSelection: typeof view.state.selection | null = null;
    let gesture: { x: number; y: number; moved: boolean } | null = null;

    const keyboardOpen = () => mobile.matches && Math.abs(viewport.width - window.innerWidth) < 24
      && Math.abs(viewport.scale - 1) < 0.05 && window.innerHeight - viewport.height >= 80;

    const cancel = () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(layoutFrame);
      frame = layoutFrame = 0;
      session.cancel();
    };

    const nativeCaretMatches = () => {
      const selection = document.getSelection();
      if (!selection?.isCollapsed || !selection.focusNode || !view.dom.contains(selection.focusNode)) return false;
      try {
        return view.posAtDOM(selection.focusNode, selection.focusOffset) === view.state.selection.head;
      } catch { return false; }
    };

    const reveal = () => {
      frame = 0;
      if (!session.pending || session.blocked || gesture || waitingForSelection || editor.isDestroyed
        || !view.hasFocus() || !view.state.selection.empty || !nativeCaretMatches() || !keyboardOpen()) return;
      session.cancel();
      const rect = root.getBoundingClientRect();
      const sticky = root.querySelector<HTMLElement>(":scope > .note-editor-sticky");
      const stickyBottom = sticky && getComputedStyle(sticky).position === "sticky"
        ? sticky.getBoundingClientRect().bottom : rect.top;
      const top = Math.max(rect.top, stickyBottom, viewport.offsetTop);
      const bottom = Math.min(rect.bottom, viewport.offsetTop + viewport.height);
      if (bottom <= top) return;
      const caret = view.coordsAtPos(view.state.selection.head);
      // A visible line stays exactly where it is, including taps near an edge.
      // Add a small buffer ONLY when the caret is actually occluded.
      if (caret.top < top) root.scrollTop -= top - caret.top + 4;
      else if (caret.bottom > bottom) root.scrollTop += caret.bottom - bottom + 24;
    };

    const schedule = () => {
      if (!session.pending || frame || layoutFrame) return;
      // useWebPlatform writes the shell size in rAF. Measure in the following
      // frame, once those CSS changes have been laid out.
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = 0;
        frame = requestAnimationFrame(reveal);
      });
    };

    const start = (x: number, y: number, target: EventTarget | null) => {
      if (!mobile.matches) return;
      cancel();
      waitingForSelection = null;
      gesture = null;
      session.release();
      if (!(target instanceof HTMLElement) || !view.dom.contains(target)
        || target.closest('button, input, textarea, select, [contenteditable="false"]')) return;
      waitingForSelection = view.state.selection;
      gesture = { x, y, moved: false };
      session.touch();
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      start(event.clientX, event.clientY, event.target);
    };
    const touchStart = (event: TouchEvent) => {
      // A real tap produces pointerdown AND touchstart. Do not reset the first
      // event's state, and retain a fallback for older touch-only WebViews.
      if (gesture) return;
      const touch = event.touches?.[0];
      if (touch) start(touch.clientX, touch.clientY, event.target);
    };
    const move = (x: number, y: number) => {
      if (!gesture || Math.hypot(x - gesture.x, y - gesture.y) <= 6) return;
      gesture.moved = true;
      session.read();
      cancel();
    };
    const pointerMove = (event: PointerEvent) => move(event.clientX, event.clientY);
    const touchMove = (event: TouchEvent) => {
      const touch = event.touches?.[0];
      if (touch) move(touch.clientX, touch.clientY);
    };
    const end = () => {
      if (!gesture) return;
      // A tap on the existing caret may produce no selection transaction.
      // Confirm by hit testing, without setting/focusing a selection ourselves.
      if (!gesture.moved && waitingForSelection && nativeCaretMatches()) {
        const hit = view.posAtCoords({ left: gesture.x, top: gesture.y });
        if (hit?.pos === view.state.selection.head) waitingForSelection = null;
      }
      gesture = null;
      session.release();
      schedule();
    };
    const stopReading = () => {
      cancel();
      gesture = null;
      waitingForSelection = null;
      session.read();
    };
    const input = (event?: Event) => {
      gesture = null;
      waitingForSelection = null;
      if (event?.type === EDITOR_NAVIGATION_EVENT) session.navigate();
      else session.input(view.composing || (event instanceof InputEvent && event.isComposing));
    };
    const compositionStart = () => { session.input(true); cancel(); };
    const compositionEnd = () => {
      session.input();
      if (keyboardOpen()) { session.request(); schedule(); }
    };
    const blur = () => { cancel(); session.blur(); waitingForSelection = null; gesture = null; };
    const selectionChanged = () => {
      if (!view.state.selection.empty) { session.select(); cancel(); return; }
      if (session.phase === "selection") session.phase = "idle";
      if (waitingForSelection && !view.state.selection.eq(waitingForSelection) && nativeCaretMatches()) {
        waitingForSelection = null;
      }
      // Selection updates alone do not request scrolling (tap, selection
      // handles, and reading gestures remain owned by the browser).
      schedule();
    };
    const transaction = ({ transaction: tr }: { transaction: Transaction }) => {
      if (!tr.docChanged && !tr.scrolledIntoView) return;
      if (!keyboardOpen() || waitingForSelection || session.phase === "reading") return;
      session.request();
      schedule();
    };
    const resize = () => {
      const height = viewport.height;
      const shrinking = height < lastHeight - 1;
      const growing = height > lastHeight + 1;
      lastHeight = height;
      if (growing || !keyboardOpen()) { cancel(); return; }
      if (shrinking && session.phase !== "reading") {
        session.request();
        schedule();
      }
    };

    scrollHandlers.set(view, () => {
      if (!mobile.matches) return false;
      if (waitingForSelection || gesture || session.blocked) return true;
      if (!keyboardOpen()) return false;
      session.request();
      schedule();
      return true;
    });
    document.addEventListener("pointerdown", pointerDown, true);
    root.addEventListener("touchstart", touchStart, { passive: true });
    root.addEventListener("pointermove", pointerMove, { passive: true });
    root.addEventListener("touchmove", touchMove, { passive: true });
    root.addEventListener("touchcancel", stopReading, { passive: true });
    document.addEventListener("pointerup", end, true);
    document.addEventListener("touchend", end, true);
    document.addEventListener("pointercancel", stopReading, true);
    root.addEventListener("wheel", stopReading, { passive: true });
    root.addEventListener(EDITOR_NAVIGATION_EVENT, input);
    view.dom.addEventListener("beforeinput", input, true);
    view.dom.addEventListener("keydown", input, true);
    view.dom.addEventListener("blur", blur);
    view.dom.addEventListener("compositionstart", compositionStart);
    view.dom.addEventListener("compositionend", compositionEnd);
    editor.on("selectionUpdate", selectionChanged);
    editor.on("transaction", transaction);
    viewport.addEventListener("resize", resize);
    return () => {
      cancel();
      scrollHandlers.delete(view);
      document.removeEventListener("pointerdown", pointerDown, true);
      root.removeEventListener("touchstart", touchStart);
      root.removeEventListener("pointermove", pointerMove);
      root.removeEventListener("touchmove", touchMove);
      root.removeEventListener("touchcancel", stopReading);
      document.removeEventListener("pointerup", end, true);
      document.removeEventListener("touchend", end, true);
      document.removeEventListener("pointercancel", stopReading, true);
      root.removeEventListener("wheel", stopReading);
      root.removeEventListener(EDITOR_NAVIGATION_EVENT, input);
      view.dom.removeEventListener("beforeinput", input, true);
      view.dom.removeEventListener("keydown", input, true);
      view.dom.removeEventListener("blur", blur);
      view.dom.removeEventListener("compositionstart", compositionStart);
      view.dom.removeEventListener("compositionend", compositionEnd);
      editor.off("selectionUpdate", selectionChanged);
      editor.off("transaction", transaction);
      viewport.removeEventListener("resize", resize);
    };
  }, [editor, readonly, scrollRef]);
}
