/** Page-relative coordinates at the viewport's horizontal centre / top reading line. */
export interface PdfReadingPosition { x: number; y: number }

export function normalizePdfReadingPosition(value: unknown): PdfReadingPosition | null {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as Partial<PdfReadingPosition>;
  return typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 100
    && typeof y === "number" && Number.isFinite(y) && Math.abs(y) <= 100 ? { x, y } : null;
}

export function capturePdfReadingPosition(viewport: HTMLElement, surface: HTMLElement): PdfReadingPosition | null {
  const view = viewport.getBoundingClientRect(), page = surface.getBoundingClientRect();
  if (!page.width || !page.height) return null;
  return {
    x: (view.left + viewport.clientLeft + viewport.clientWidth / 2 - page.left) / page.width,
    y: (view.top + viewport.clientTop + 12 - page.top) / page.height,
  };
}

export function restorePdfReadingPosition(viewport: HTMLElement, surface: HTMLElement, position: PdfReadingPosition | null) {
  const view = viewport.getBoundingClientRect(), page = surface.getBoundingClientRect();
  viewport.scrollTo({
    left: position ? viewport.scrollLeft + page.left + page.width * position.x
      - view.left - viewport.clientLeft - viewport.clientWidth / 2 : viewport.scrollLeft,
    top: viewport.scrollTop + page.top + page.height * (position?.y ?? 0) - view.top - viewport.clientTop - 12,
    behavior: "instant",
  });
}

/** Use the same top reading line for saving and restoring, not the screen centre. */
export function pdfPageAtReadingLine(viewport: HTMLElement, surfaces: Map<number, HTMLElement>, pageCount: number): number {
  const top = viewport.getBoundingClientRect().top + viewport.clientTop + 12;
  let low = 1, high = pageCount;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const surface = surfaces.get(middle);
    if (!surface) return low;
    if (surface.getBoundingClientRect().bottom <= top) low = middle + 1;
    else high = middle;
  }
  return low;
}
