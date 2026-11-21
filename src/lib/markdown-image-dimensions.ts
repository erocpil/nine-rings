/** Markdown HTML images accept positive integer pixel dimensions only. */
export function imageDimensionPixels(value: unknown): number | undefined {
  if (typeof value === "string" && !/^[1-9]\d*(?:px)?$/.test(value)) return;
  if (typeof value !== "number" && typeof value !== "string") return;
  const pixels = typeof value === "number" ? value : Number(value.replace(/px$/, ""));
  if (Number.isSafeInteger(pixels) && pixels > 0) return pixels;
}

export function htmlImageDimensions(properties: Record<string, unknown>) {
  const width = imageDimensionPixels(properties.width);
  const height = imageDimensionPixels(properties.height);
  return { ...(width ? { width: `${width}px` } : {}), ...(height ? { height } : {}) };
}
