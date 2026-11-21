import { useEffect, useState } from "react";
import { browserPreviewMatches } from "../lib/local-files/browser-preview";
import { FileBrowserPreviewFind, type PreviewFindInput } from "./FileBrowserPreviewFind";

type TextRun = { node: Text; start: number; end: number };

/** Match visible text without rewriting rendered DOM or breaking links/selection. */
function renderedMatches(root: HTMLElement, query: string, matchCase: boolean) {
  const ranges: Range[] = [];
  if (!query) return { ranges, limited: false };
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let group: Element | null = null;
  let text = "";
  let runs: TextRun[] = [];
  const collect = () => {
    const found = browserPreviewMatches(text, query, matchCase);
    let index = 0;
    for (const { from, to } of found.matches) {
      if (ranges.length === 1000) return true;
      while (runs[index].end <= from) index++;
      const first = runs[index];
      while (runs[index].end < to) index++;
      const last = runs[index];
      const range = root.ownerDocument.createRange();
      range.setStart(first.node, from - first.start);
      range.setEnd(last.node, to - last.start);
      ranges.push(range);
    }
    return found.limited;
  };
  for (let item = walker.nextNode(); item; item = walker.nextNode()) {
    const node = item as Text;
    const parent = node.parentElement;
    if (!node.data || !parent || parent.closest("button, [aria-hidden='true'], [hidden], math")) continue;
    const block = parent.closest("p, h1, h2, h3, h4, h5, h6, td, th, li, pre, summary, .markdown-preview-block");
    if (block !== group) {
      if (collect()) return { ranges, limited: true };
      group = block;
      text = "";
      runs = [];
    }
    runs.push({ node, start: text.length, end: text.length + node.length });
    text += node.data;
  }
  return { ranges, limited: collect() };
}

function paint(name: string, ranges: readonly Range[]) {
  if (typeof Highlight === "undefined" || !CSS.highlights) return;
  const highlight = CSS.highlights.get(name) ?? new Highlight();
  if (name === "workbench-preview-current") highlight.priority = 1;
  CSS.highlights.set(name, highlight);
  for (const range of ranges) highlight.add(range);
  return () => {
    for (const range of ranges) highlight.delete(range);
    if (!highlight.size) CSS.highlights.delete(name);
  };
}

export function FileBrowserRenderedFind({ viewport, ...input }: PreviewFindInput & { viewport: HTMLElement | null }) {
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<{ ranges: Range[]; limited: boolean }>({ ranges: [], limited: false });
  useEffect(() => {
    const root = viewport?.querySelector<HTMLElement>(".ProseMirror");
    if (!root) return;
    const search = () => setResult(renderedMatches(root, input.query, input.matchCase));
    search();
    if (!input.query) return;
    const observer = new MutationObserver(search);
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [viewport, input.query, input.matchCase]);
  useEffect(() => { setIndex(0); }, [input.query, input.matchCase, viewport]);
  const current = Math.min(index, Math.max(0, result.ranges.length - 1));
  const match = result.ranges[current];
  useEffect(() => paint("workbench-preview-match", result.ranges), [result]);
  useEffect(() => {
    if (!viewport || !match) return;
    const bounds = viewport.getBoundingClientRect();
    const target = match.getBoundingClientRect();
    if (target.top < bounds.top) viewport.scrollTop += target.top - bounds.top - 8;
    else if (target.bottom > bounds.bottom) viewport.scrollTop += target.bottom - bounds.bottom + 8;
    return paint("workbench-preview-current", [match]);
  }, [viewport, match]);
  return <FileBrowserPreviewFind {...input} current={current} count={result.ranges.length} limited={result.limited}
    step={direction => { if (result.ranges.length) setIndex((current + direction + result.ranges.length) % result.ranges.length); }} />;
}
