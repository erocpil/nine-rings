import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

interface Position {
  left: number;
  top: number | "auto";
  bottom: number | "auto";
  width: number;
  maxHeight: number;
}

/** Anchor document navigation to its trigger, keeping the trigger clickable. */
export function useDocumentPanelPosition({
  open,
  triggerRef,
  panelRef,
  compact,
  layoutKey,
  width = 420,
}: {
  open: boolean;
  triggerRef: RefObject<HTMLElement>;
  panelRef: RefObject<HTMLElement>;
  compact: boolean;
  layoutKey?: boolean | string;
  width?: number;
}): CSSProperties | undefined {
  const [position, setPosition] = useState<Position | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current,
      panel = panelRef.current;
    if (!trigger || !panel) return;
    const editor = panel.closest(".note-editor");
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = trigger.getBoundingClientRect();
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const gap = 6,
        margin = 8;
      const panelWidth = Math.max(
        0,
        Math.min(
          width,
          // Floating previews can extend beyond a narrow editor. The dock has
          // its own 50% cap; keep previews readable without escaping the viewport.
          compact
            // Phone portrait popovers should keep the former near-full-width
            // reading surface. Landscape leaves room beside the panel so it
            // does not cover every line of the document.
            ? viewportHeight >= viewportWidth ? viewportWidth : viewportWidth * 0.78
            : Math.max(
                420,
                (editor?.getBoundingClientRect().width ?? viewportWidth) / 2,
              ),
          viewportWidth - margin * 2,
        ),
      );
      const below = Math.max(
        0,
        viewportTop + viewportHeight - rect.bottom - gap - margin,
      );
      const above = Math.max(0, rect.top - viewportTop - gap - margin);
      const placeAbove =
        below < Math.min(160, panel.scrollHeight) && above > below;
      const maxHeight = Math.min(
        440,
        viewportHeight * 0.58,
        placeAbove ? above : below,
      );
      const next: Position = {
        left: Math.max(
          viewportLeft + margin,
          Math.min(
            rect.right - panelWidth,
            viewportLeft + viewportWidth - panelWidth - margin,
          ),
        ),
        top: placeAbove ? "auto" : rect.bottom + gap,
        bottom: placeAbove ? window.innerHeight - rect.top + gap : "auto",
        width: panelWidth,
        maxHeight,
      };
      setPosition((previous) =>
        previous &&
        Object.keys(next).every(
          (key) =>
            previous[key as keyof Position] === next[key as keyof Position],
        )
          ? previous
          : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(trigger);
    observer.observe(panel);
    if (editor) observer.observe(editor);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [open, triggerRef, panelRef, compact, layoutKey, width]);

  if (!open) return undefined;
  return {
    position: "fixed",
    right: "auto",
    bottom: "auto",
    margin: 0,
    zIndex: 70,
    ...position,
    maxWidth: position?.width,
    visibility: position ? "visible" : "hidden",
  };
}
