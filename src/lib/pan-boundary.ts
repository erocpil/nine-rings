/** Stop outward motion at a boundary, but let old out-of-range positions move
 * inward without jumping. Each axis is independent. */
export function constrainPanAxis(
  previous: number,
  requested: number,
  limit: number,
): number {
  if (![previous, requested, limit].every(Number.isFinite)) return previous;
  limit = Math.max(0, limit);
  if (previous > limit) return Math.min(previous, Math.max(-limit, requested));
  if (previous < -limit) return Math.max(previous, Math.min(limit, requested));
  return Math.max(-limit, Math.min(limit, requested));
}
export function visiblePanLimit(
  contentSize: number,
  viewportSize: number,
  visible = 24,
): number {
  return Math.max(
    0,
    (contentSize + viewportSize) / 2 -
      Math.min(visible, contentSize, viewportSize),
  );
}
