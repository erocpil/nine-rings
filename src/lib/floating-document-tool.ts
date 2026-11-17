import { anchoredMenuPosition } from "./anchored-menu-position";
import type { CommandAnchor } from "./editor-command-surface";

/** Shared viewport geometry for React portals and CodeMirror-owned panels.
 * CodeMirror keeps DOM ownership using the native top layer; React supplies a
 * portal, avoiding editor clipping without remounting the editor itself. */
export function mountFloatingDocumentTool(
  element: HTMLElement,
  viewport: HTMLElement,
  anchor?: CommandAnchor | null,
  topLayer = true,
) {
  const width = element.getBoundingClientRect().width;
  Object.assign(element.style, {
    position: "fixed",
    margin: "0",
    inset: "auto",
    boxSizing: "border-box",
    width: `${width}px`,
    maxWidth: "calc(100vw - 16px)",
    maxHeight: "calc(100dvh - 16px)",
    overflowY: "auto",
  });
  let frame = 0;
  const position = () => {
    const bounds = viewport.getBoundingClientRect();
    const toolbar = Array.from(
      viewport.querySelectorAll<HTMLElement>(".document-toolbar"),
    ).find((item) => item.getClientRects().length > 0);
    const top = Math.max(
      bounds.top,
      toolbar?.getBoundingClientRect().bottom ?? bounds.top,
    );
    const fallback = {
      left: bounds.left + 6,
      right: bounds.left + 6,
      top: top + 6,
      bottom: top,
    };
    const rect = anchor?.trigger?.isConnected
      ? anchor.trigger.getClientRects().length
        ? anchor.trigger.getBoundingClientRect()
        : fallback
      : (anchor?.rect ?? fallback);
    const point = anchoredMenuPosition(
      rect,
      element.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      anchor?.placement ?? "below",
    );
    element.style.left = `${point.x}px`;
    element.style.top = `${point.y}px`;
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(position);
  };
  // Position before entering the top layer so native focus steps never use
  // the panel's old absolute position above a scrolled document.
  position();
  if (topLayer && typeof element.showPopover === "function") {
    element.setAttribute("popover", "manual");
    element.showPopover();
    position();
  }
  const observer = new ResizeObserver(schedule);
  observer.observe(element);
  observer.observe(viewport);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, true);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule, true);
    if (element.hasAttribute("popover")) {
      if (element.isConnected && element.matches(":popover-open"))
        element.hidePopover();
      element.removeAttribute("popover");
    }
    element.removeAttribute("style");
  };
}
