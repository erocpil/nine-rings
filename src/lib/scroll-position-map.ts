export type ScrollAnchor = { source: number; preview: number };

/** Interpolate between shared content boundaries, preserving both ends. */
export function mapScrollPosition(position: number, anchors: ScrollAnchor[], from: "source" | "preview"): number {
  const to = from === "source" ? "preview" : "source";
  if (!anchors.length) return 0;
  if (position <= anchors[0][from]) return anchors[0][to];
  const last = anchors[anchors.length - 1];
  if (position >= last[from]) return last[to];
  let low = 0, high = anchors.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (anchors[middle][from] <= position) low = middle;
    else high = middle;
  }
  const start = anchors[low], end = anchors[high];
  const distance = end[from] - start[from];
  return distance <= 0 ? start[to] : start[to] + (end[to] - start[to]) * ((position - start[from]) / distance);
}
