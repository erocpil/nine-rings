import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";

/** Capture before node views handle links, folding, task checkboxes or editing. */
export function useBlockSelectionGestures(
  editor: Editor | null,
  active: boolean,
  onToggle: (position: number) => void,
) {
  const suppressClickUntil = useRef(0);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (!active && Date.now() >= suppressClickUntil.current) return;
    const root = editor.view.dom;
    let gesture: { id: number; x: number; y: number; position: number; moved: boolean } | null = null;
    const positionAt = (target: EventTarget | null) => {
      let element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
      while (element && element.parentElement !== root) {
        if (element === root) return null;
        element = element.parentElement;
      }
      if (!element) return null;
      try {
        const position = editor.view.posAtDOM(element, 0, -1);
        const resolved = editor.state.doc.resolve(position);
        return resolved.depth > 0 ? resolved.before(1) : position;
      } catch { return null; }
    };
    const blockAction = (event: Event) => {
      if (!active) return;
      event.stopPropagation();
      // Do not cancel pointer events: the browser must still allow scrolling.
      if (!event.type.startsWith("pointer")) event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      // A final deselection can exit the mode before the compatibility click.
      if (Date.now() < suppressClickUntil.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!active) return;
      blockAction(event);
      const position = positionAt(event.target);
      if (position !== null) onToggle(position);
    };
    const touchStart = (event: TouchEvent) => {
      if (!active) return;
      event.stopPropagation();
      const touch = event.changedTouches[0];
      const position = positionAt(event.target);
      gesture = event.touches.length === 1 && touch && position !== null
        ? { id: touch.identifier, x: touch.clientX, y: touch.clientY, position, moved: false }
        : null;
    };
    const touchMove = (event: TouchEvent) => {
      if (!active) return;
      event.stopPropagation();
      const touch = Array.from(event.touches).find((item) => item.identifier === gesture?.id);
      if (gesture && (!touch || event.touches.length !== 1 || Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) > 12)) gesture.moved = true;
    };
    const touchEnd = (event: TouchEvent) => {
      if (!active) return;
      event.stopPropagation();
      const previous = gesture;
      gesture = null;
      suppressClickUntil.current = Date.now() + 800;
      const touch = Array.from(event.changedTouches).find((item) => item.identifier === previous?.id);
      if (!previous || !touch || previous.moved || Math.hypot(touch.clientX - previous.x, touch.clientY - previous.y) > 12) return;
      event.preventDefault();
      onToggle(previous.position);
    };
    const touchCancel = () => { gesture = null; };
    const selectionEvents: Array<[string, EventListener]> = [
      ["touchstart", touchStart as EventListener],
      ["touchmove", touchMove as EventListener],
      ["touchend", touchEnd as EventListener],
      ["touchcancel", touchCancel],
      ...["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "contextmenu"].map((name): [string, EventListener] => [name, blockAction]),
    ];
    // Outside selection mode only keep the short-lived compatibility-click guard;
    // normal reading must not acquire non-passive touch listeners.
    const events: Array<[string, EventListener]> = [
      ["click", click as EventListener],
      ...(active ? selectionEvents : []),
    ];
    for (const [name, handler] of events) root.addEventListener(name, handler, { capture: true, passive: false });
    return () => {
      for (const [name, handler] of events) root.removeEventListener(name, handler, true);
    };
  }, [active, editor, onToggle]);
}
