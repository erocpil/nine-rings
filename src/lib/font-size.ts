/** Clipboard CSS keywords/relative units are not numeric editor sizes. */
export function fontSizePixels(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const match = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(px|pt|pc|in|cm|mm|q)?\s*$/i.exec(
    String(value),
  );
  if (!match) return undefined;
  const unit = (match[2] ?? "px").toLowerCase();
  const factors: Record<string, number> = {
    px: 1,
    pt: 96 / 72,
    pc: 16,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    q: 96 / 101.6,
  };
  const pixels = Number(match[1]) * factors[unit];
  return Number.isFinite(pixels) && pixels > 0 && pixels <= 4096
    ? pixels
    : undefined;
}
