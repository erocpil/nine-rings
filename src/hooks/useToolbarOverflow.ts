import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

/** Measure live controls (including current labels/fonts), without cloning editor UI. */
export function useToolbarOverflow(ref: RefObject<HTMLElement>, enabled: boolean) {
  const [hiddenTools, setHiddenTools] = useState("");
  const measure = useCallback(() => {
    const toolbar = ref.current;
    if (!toolbar) return;
    const optional = Array.from(toolbar.querySelectorAll<HTMLElement>(".toolbar-secondary > *"));
    optional.forEach(el => el.removeAttribute("data-toolbar-overflow"));
    if (!enabled || !toolbar.clientWidth) { setHiddenTools(""); return; }
    const style = getComputedStyle(toolbar);
    const gap = parseFloat(style.columnGap) || 0;
    const width = (el: HTMLElement) => {
      const css = getComputedStyle(el);
      return el.getBoundingClientRect().width + (parseFloat(css.marginLeft) || 0) + (parseFloat(css.marginRight) || 0);
    };
    const fixed = Array.from(toolbar.children).filter((el): el is HTMLElement =>
      el instanceof HTMLElement && !el.classList.contains("toolbar-secondary") && getComputedStyle(el).display !== "none");
    let remaining = toolbar.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
      - fixed.reduce((sum, el) => sum + width(el), 0) - Math.max(0, fixed.length - 1) * gap;
    const sizes = optional.map(width);
    optional.forEach((el, index) => {
      // Separators in the optional section aren't useful when individual tools overflow.
      const fits = !el.classList.contains("menu-sep") && sizes[index] + gap <= remaining;
      if (fits) remaining -= sizes[index] + gap;
      else el.setAttribute("data-toolbar-overflow", "true");
    });
    setHiddenTools(optional.filter(el => el.hasAttribute("data-toolbar-overflow"))
      .map(el => el.dataset.toolbarTool).filter(Boolean).join(","));
  }, [ref, enabled]);
  // Labels change with the selection, save state and text size.
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const toolbar = ref.current;
    if (!toolbar) return;
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    let disposed = false;
    void document.fonts.ready.then(() => { if (!disposed) measure(); });
    return () => { disposed = true; observer.disconnect(); };
  }, [ref, measure]);
  return hiddenTools.split(",");
}
