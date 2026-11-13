import { mapScrollPosition, type ScrollAnchor } from "./scroll-position-map";
import type { PreviewScrollPosition } from "./local-files/browser-preview";

const layouts = new WeakMap<HTMLElement, { width: number; height: number; length: number; anchors: ScrollAnchor[] }>();
export function invalidatePreviewAnchors(element: HTMLElement) { layouts.delete(element); }
function renderedAnchors(element: HTMLElement, length: number): ScrollAnchor[] {
  const cached = layouts.get(element);
  if (cached && cached.width === element.clientWidth && cached.height === element.scrollHeight && cached.length === length) return cached.anchors;
  const top = element.getBoundingClientRect().top + element.clientTop;
  const anchors: ScrollAnchor[] = [{ source: 0, preview: 0 }];
  for (const item of element.querySelectorAll<HTMLElement>("[data-preview-source-offset]")) {
    if (!item.getClientRects().length) continue;
    const source = Number(item.dataset.previewSourceOffset);
    const preview = item.getBoundingClientRect().top - top + element.scrollTop;
    const previous = anchors[anchors.length - 1];
    if (source > previous.source && preview >= previous.preview) anchors.push({ source, preview });
  }
  const last = anchors[anchors.length - 1];
  if (length > last.source) anchors.push({ source: length, preview: Math.max(last.preview, element.scrollHeight) });
  layouts.set(element, { width: element.clientWidth, height: element.scrollHeight, length, anchors });
  return anchors;
}
export function captureRenderedPreview(element: HTMLElement, position: PreviewScrollPosition, length: number) {
  const cached = layouts.get(element);
  const changed = !cached || cached.width !== element.clientWidth || cached.height !== element.scrollHeight || cached.length !== length;
  if (changed || position.offset === undefined || Math.abs(position.top - element.scrollTop) > .5) {
    position.offset = mapScrollPosition(element.scrollTop, renderedAnchors(element, length), "preview");
  }
  position.top = element.scrollTop; position.left = element.scrollLeft;
}
export function restoreRenderedPreview(element: HTMLElement, position: PreviewScrollPosition, length: number) {
  element.scrollTop = position.offset === undefined ? position.top : mapScrollPosition(position.offset, renderedAnchors(element, length), "source");
  element.scrollLeft = position.left;
  position.top = element.scrollTop; position.left = element.scrollLeft;
}

/** Measure the actual wrapped pre text, rather than assuming a constant row width. */
function textGeometry(element: HTMLElement) {
  const text = element.textContent ?? "";
  const nodes: { node: Text; from: number; to: number }[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let from = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const to = from + (node.textContent?.length ?? 0);
    nodes.push({ node: node as Text, from, to }); from = to;
  }
  const top = element.getBoundingClientRect().top + element.clientTop;
  return { length: text.length, y(offset: number) {
    let at = Math.min(text.length - 1, Math.max(0, Math.floor(offset)));
    while (at < text.length - 1 && /[\r\n]/.test(text[at])) at++;
    const part = nodes.find(part => part.from <= at && part.to > at);
    if (!part) return 0;
    const range = document.createRange();
    range.setStart(part.node, at - part.from); range.setEnd(part.node, at - part.from + 1);
    return range.getBoundingClientRect().top - top + element.scrollTop;
  } };
}
export function captureTextPreview(element: HTMLElement, position: PreviewScrollPosition) {
  if (position.offset === undefined || Math.abs(position.top - element.scrollTop) > .5) {
    const geometry = textGeometry(element);
    let low = 0, high = geometry.length;
    while (low < high) { const mid = (low + high) >>> 1; if (geometry.y(mid) < element.scrollTop - 1) low = mid + 1; else high = mid; }
    position.offset = low;
  }
  position.top = element.scrollTop; position.left = element.scrollLeft;
}
export function restoreTextPreview(element: HTMLElement, position: PreviewScrollPosition) {
  element.scrollTop = position.offset === undefined ? position.top : textGeometry(element).y(position.offset);
  element.scrollLeft = position.left;
  position.top = element.scrollTop; position.left = element.scrollLeft;
}
