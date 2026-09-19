import { useEffect } from "react";

/** Reveal native scrollbars near their own edge without changing layout or scrolling. */
export function useEdgeScrollbars() {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia(
      "(min-width: 769px) and (hover: hover) and (pointer: fine) and (forced-colors: none)",
    );
    let visible = new Set<HTMLElement>();
    let frame = 0;
    let dragging = false;
    let point: { x: number; y: number } | null = null;
    const setVisible = (next: Set<HTMLElement>) => {
      for (const element of visible)
        if (!next.has(element))
          element.removeAttribute("data-scrollbar-visible");
      for (const element of next)
        if (!visible.has(element))
          element.setAttribute("data-scrollbar-visible", "");
      visible = next;
    };
    const update = () => {
      frame = 0;
      if (dragging || !media.matches || !point) return;
      const next = new Set<HTMLElement>();
      // A native scrollbar can target the pane's parent (not the scrollable
      // element) in WebKit. Hit-test the current coordinates instead of relying
      // on a stale event target, then probe just inside the native gutter.
      const hit = document.elementFromPoint(point.x, point.y);
      const candidates = new Set<Element>();
      const collect = (start: Element | null) => {
        for (let element = start; element; element = element.parentElement)
          candidates.add(element);
      };
      collect(hit);
      for (const [x, y] of [
        [point.x - 18, point.y],
        [point.x + 18, point.y],
        [point.x, point.y - 18],
      ]) {
        const inside = document.elementFromPoint(x, y);
        // Do not reveal panes behind dialogs, menus or other overlapping UI.
        if (inside && hit?.contains(inside)) collect(inside);
      }
      for (const element of candidates) {
        if (
          element instanceof HTMLElement &&
          element.isConnected &&
          (element.scrollHeight > element.clientHeight + 1 ||
            element.scrollWidth > element.clientWidth + 1)
        ) {
          const rect = element.getBoundingClientRect();
          if (
            point.x >= rect.left &&
            point.x <= rect.right &&
            point.y >= rect.top &&
            point.y <= rect.bottom
          ) {
            const style = getComputedStyle(element);
            const vertical =
              /^(auto|scroll)$/.test(style.overflowY) &&
              element.scrollHeight > element.clientHeight + 1;
            const horizontal =
              /^(auto|scroll)$/.test(style.overflowX) &&
              element.scrollWidth > element.clientWidth + 1;
            const nearVertical =
              style.direction === "rtl"
                ? point.x - rect.left <= 18
                : rect.right - point.x <= 18;
            if (
              (vertical && nearVertical) ||
              (horizontal && rect.bottom - point.y <= 18)
            )
              next.add(element);
          }
        }
      }
      setVisible(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const move = (event: MouseEvent | PointerEvent) => {
      if (!media.matches) return;
      if ("pointerType" in event && event.pointerType !== "mouse") {
        dragging = false;
        point = null;
        root.removeAttribute("data-edge-scrollbars");
        setVisible(new Set());
        return;
      }
      if (!root.hasAttribute("data-edge-scrollbars"))
        root.setAttribute("data-edge-scrollbars", "");
      if (!event.buttons) dragging = false;
      point = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const down = (event: MouseEvent | PointerEvent) => {
      move(event);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      update();
      dragging =
        (!("pointerType" in event) || event.pointerType === "mouse") &&
        event.button === 0 &&
        visible.size > 0;
    };
    const up = (event: MouseEvent) => {
      dragging = false;
      point = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const clear = () => {
      dragging = false;
      point = null;
      setVisible(new Set());
    };
    const leave = () => {
      if (!dragging) clear();
    };
    const syncMedia = () => {
      clear();
      root.toggleAttribute("data-edge-scrollbars", media.matches);
    };
    syncMedia();
    media.addEventListener("change", syncMedia);
    document.addEventListener("pointermove", move, {
      passive: true,
      capture: true,
    });
    // Native WebKit scrollbar interactions do not always deliver pointermove.
    document.addEventListener("mousemove", move, {
      passive: true,
      capture: true,
    });
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("mousedown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("mouseup", up, true);
    window.addEventListener("blur", clear);
    window.addEventListener("pointercancel", clear, true);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, {
      passive: true,
      capture: true,
    });
    document.documentElement.addEventListener("pointerleave", leave);
    document.documentElement.addEventListener("mouseleave", leave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      clear();
      root.removeAttribute("data-edge-scrollbars");
      media.removeEventListener("change", syncMedia);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("mousedown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("mouseup", up, true);
      window.removeEventListener("blur", clear);
      window.removeEventListener("pointercancel", clear, true);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      document.documentElement.removeEventListener("pointerleave", leave);
      document.documentElement.removeEventListener("mouseleave", leave);
    };
  }, []);
}
