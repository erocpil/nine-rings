/** 将命中行居中到真正可见的正文区域；首尾由滚动边界限制。 */
export function centerSearchMatch(
  root: HTMLElement,
  line: { top: number; bottom: number },
  obscuredTop?: number,
): void {
  const bounds = root.getBoundingClientRect();
  const view = root.ownerDocument.defaultView;
  const viewport = view?.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportBottom = viewportTop + (viewport?.height ?? view?.innerHeight ?? bounds.bottom);
  const top = Math.max(bounds.top, Math.min(obscuredTop ?? bounds.top, bounds.bottom), viewportTop);
  const bottom = Math.min(bounds.bottom, viewportBottom);
  if (bottom <= top) return;
  const nextTop = root.scrollTop + (line.top + line.bottom - top - bottom) / 2;
  root.scrollTop = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, nextTop));
}
