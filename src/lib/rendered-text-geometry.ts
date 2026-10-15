/** Resolve a visible text line without assuming equal line lengths or heights.
 * Custom NodeViews whose display differs from their model use the caller's
 * block-level fallback; toolbar text must never count as document content. */
export function renderedTextGeometry(element: Element, text: string) {
  if (!text || element.textContent !== text) return null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; from: number; to: number }[] = [];
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push({ node, from: offset, to: offset + node.length });
    offset += node.length;
  }
  const range = document.createRange();
  const rectAt = (offset: number) => {
    offset = Math.max(0, Math.min(text.length - 1, offset));
    let low = 0, high = nodes.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (nodes[mid].to <= offset) low = mid + 1; else high = mid;
    }
    const target = nodes[low];
    if (!target) return null;
    range.setStart(target.node, offset - target.from);
    range.setEnd(target.node, offset - target.from + 1);
    const rect = range.getBoundingClientRect();
    return rect.height > 0 ? rect : null;
  };
  return {
    rectAt,
    offsetAtY(y: number) {
      let low = 0, high = text.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        const rect = rectAt(mid);
        if (!rect) return null;
        if (rect.bottom <= y + 1) low = mid + 1; else high = mid;
      }
      return low;
    },
  };
}
