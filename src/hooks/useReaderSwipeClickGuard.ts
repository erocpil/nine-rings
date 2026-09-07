import { useEffect, type RefObject } from "react";

/** Ignore a swipe's trailing compatibility click, including clicks retargeted
 * to reader chrome after immersive controls appear/disappear. */
export function useReaderSwipeClickGuard(toolbarRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const reader = toolbarRef.current?.closest<HTMLElement>(".pdf-reader");
    if (!reader) return;
    let gesture: { id: number; x: number; y: number; moved: boolean } | null =
      null;
    let suppressUntil = 0;
    const update = (touches: TouchList) => {
      if (!gesture) return;
      for (const touch of Array.from(touches)) {
        if (touch.identifier !== gesture.id) continue;
        if (
          Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) > 8
        )
          gesture.moved = true;
      }
    };
    const start = (event: TouchEvent) => {
      // A new deliberate tap must work immediately after scrolling.
      suppressUntil = 0;
      const touch = event.touches[0];
      gesture = touch
        ? {
            id: touch.identifier,
            x: touch.clientX,
            y: touch.clientY,
            moved: event.touches.length !== 1,
          }
        : null;
    };
    const move = (event: TouchEvent) => {
      update(event.touches);
      if (gesture && event.touches.length !== 1) gesture.moved = true;
    };
    const end = (event: TouchEvent) => {
      update(event.changedTouches);
      if (gesture?.moved) suppressUntil = performance.now() + 700;
      if (!event.touches.length) gesture = null;
    };
    const cancel = () => {
      gesture = null;
      suppressUntil = performance.now() + 700;
    };
    const click = (event: MouseEvent) => {
      // Keyboard and assistive-technology activation has no pointer click count.
      if (event.detail === 0 || performance.now() >= suppressUntil) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const pointerDown = (event: PointerEvent) => {
      // A real mouse/pen press starts a new action; a trailing compatibility
      // click has no new pointer-down sequence.
      if (event.pointerType === "mouse" || event.pointerType === "pen")
        suppressUntil = 0;
    };
    reader.addEventListener("pointerdown", pointerDown, true);
    reader.addEventListener("touchstart", start, {
      capture: true,
      passive: true,
    });
    reader.addEventListener("touchmove", move, {
      capture: true,
      passive: true,
    });
    reader.addEventListener("touchend", end, { capture: true, passive: true });
    reader.addEventListener("touchcancel", cancel, {
      capture: true,
      passive: true,
    });
    reader.addEventListener("click", click, true);
    return () => {
      reader.removeEventListener("pointerdown", pointerDown, true);
      reader.removeEventListener("touchstart", start, true);
      reader.removeEventListener("touchmove", move, true);
      reader.removeEventListener("touchend", end, true);
      reader.removeEventListener("touchcancel", cancel, true);
      reader.removeEventListener("click", click, true);
    };
  }, [toolbarRef]);
}
