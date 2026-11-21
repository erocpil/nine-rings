import { useEffect, useMemo, useState } from "react";
import { browserPreviewMatches } from "../lib/local-files/browser-preview";
import { FileBrowserPreviewFind, type PreviewFindInput } from "./FileBrowserPreviewFind";

type TextRun = { node: Text; start: number; end: number };
type TextGroup = { text: string; runs: TextRun[] };

/** Index displayed text once per render and retain its DOM positions for ranges. */
function indexRenderedText(root: HTMLElement) {
  const groups: TextGroup[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let group: Element | null = null;
  let text = "";
  let runs: TextRun[] = [];
  for (let item = walker.nextNode(); item; item = walker.nextNode()) {
    const node = item as Text;
    const parent = node.parentElement;
    if (!node.data || !parent || parent.closest("button, [aria-hidden='true'], [hidden], math")) continue;
    const block = parent.closest("p, h1, h2, h3, h4, h5, h6, td, th, li, pre, summary, .markdown-preview-block");
    if (block !== group) {
      if (runs.length) groups.push({ text, runs });
      group = block;
      text = "";
      runs = [];
    }
    runs.push({ node, start: text.length, end: text.length + node.length });
    text += node.data;
  }
  if (runs.length) groups.push({ text, runs });
  return groups;
}

function renderedMatches(groups: TextGroup[], query: string, matchCase: boolean) {
  const ranges: Range[] = [];
  if (!query) return { ranges, limited: false };
  for (const { text, runs } of groups) {
    const found = browserPreviewMatches(text, query, matchCase);
    let index = 0;
    for (const { from, to } of found.matches) {
      if (ranges.length === 1000) return { ranges, limited: true };
      while (runs[index].end <= from) index++;
      const first = runs[index];
      while (runs[index].end < to) index++;
      const last = runs[index];
      const range = first.node.ownerDocument.createRange();
      range.setStart(first.node, from - first.start);
      range.setEnd(last.node, to - last.start);
      ranges.push(range);
    }
    if (found.limited) return { ranges, limited: true };
  }
  return { ranges, limited: false };
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
  const { query, matchCase } = input;
  const [selection, setSelection] = useState<{ query: string; matchCase: boolean; viewport: HTMLElement | null; index: number }>();
  const [groups, setGroups] = useState<TextGroup[]>([]);
  useEffect(() => {
    const root = viewport?.querySelector<HTMLElement>(".ProseMirror");
    if (!root) { setGroups([]); return; }
    const refresh = () => setGroups(indexRenderedText(root));
    const observer = new MutationObserver(refresh);
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributeFilter: ["hidden", "aria-hidden"] });
    refresh();
    return () => observer.disconnect();
  }, [viewport]);
  const result = useMemo(() => renderedMatches(groups, query, matchCase), [groups, query, matchCase]);
  const sameSearch = selection && selection.query === query && selection.matchCase === matchCase && selection.viewport === viewport;
  if (selection && !sameSearch) setSelection(undefined);
  const index = sameSearch ? selection.index : 0;
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
    step={direction => {
      const count = result.ranges.length;
      if (count) setSelection({ query, matchCase, viewport, index: (current + direction + count) % count });
    }} />;
}
