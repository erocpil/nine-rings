/** Viewport coordinates shared by context flyouts and toolbar command menus. */
export function anchoredMenuPosition(
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: "side" | "below",
  gap = 6,
) {
  const below = anchor.bottom + gap;
  const above = anchor.top - menu.height - gap;
  const x = placement === "below" ? anchor.left
    : anchor.right + gap + menu.width <= viewport.width - 8
      ? anchor.right + gap : anchor.left - menu.width - gap;
  const y = placement === "side" ? anchor.top
    : below + menu.height <= viewport.height - 8 ? below : above >= 8 ? above : below;
  return {
    x: Math.max(8, Math.min(x, viewport.width - menu.width - 8)),
    y: Math.max(8, Math.min(y, viewport.height - menu.height - 8)),
  };
}
