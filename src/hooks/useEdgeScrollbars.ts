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
    let point: { x: number; y: number; target: EventTarget | null } | null =
      null;
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
      let element = point.target instanceof Element ? point.target : null;
      while (element) {
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
        element = element.parentElement;
      }
      setVisible(next);
    };
    const move = (event: PointerEvent) => {
      if (!media.matches) return;
      if (event.pointerType !== "mouse") {
        root.removeAttribute("data-edge-scrollbars");
        setVisible(new Set());
        return;
      }
      if (!root.hasAttribute("data-edge-scrollbars"))
        root.setAttribute("data-edge-scrollbars", "");
      if (!event.buttons) dragging = false;
      point = { x: event.clientX, y: event.clientY, target: event.target };
      if (!frame) frame = requestAnimationFrame(update);
    };
    const down = (event: PointerEvent) => {
      move(event);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      update();
      dragging =
        event.pointerType === "mouse" && event.button === 0 && visible.size > 0;
    };
    const up = () => {
      dragging = false;
      if (!frame) frame = requestAnimationFrame(update);
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
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("mouseup", up, true);
    window.addEventListener("blur", clear);
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      clear();
      root.removeAttribute("data-edge-scrollbars");
      media.removeEventListener("change", syncMedia);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("mouseup", up, true);
      window.removeEventListener("blur", clear);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, []);
}
