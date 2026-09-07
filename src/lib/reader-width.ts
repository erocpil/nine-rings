/** Per-document width preferences; null keeps legacy PDF zoom behaviour. */
export function normalizePdfWidth(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(0.1, Math.min(10, value)) : null;
}

export function normalizeEpubWidth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(60, Math.min(100, Math.round(value))) : 100;
}

export function lockedPdfScale(ratio: number, viewportWidth: number, pageWidth: number): number {
  return Math.max(160, viewportWidth - 24) * ratio / Math.max(1, pageWidth);
}
