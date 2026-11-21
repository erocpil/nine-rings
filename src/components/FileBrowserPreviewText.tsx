import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { browserPreviewMatches, type PreviewScrollPosition } from "../lib/local-files/browser-preview";
import { captureTextPreview, restoreTextPreview } from "../lib/preview-scroll-position";
import { FileBrowserPreviewFind, type PreviewFindInput } from "./FileBrowserPreviewFind";

export function FileBrowserPreviewText({ position, wrap, source, find }: {
  position?: PreviewScrollPosition; wrap: boolean; source: string; find?: PreviewFindInput;
}) {
  const query = find?.query ?? "";
  const matchCase = find?.matchCase ?? false;
  const [index, setIndex] = useState(0);
  const pre = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => { if (pre.current && position) restoreTextPreview(pre.current, position); }, [position, source]);
  const result = useMemo(() => browserPreviewMatches(source, query, matchCase), [source, query, matchCase]);
  const current = Math.min(index, Math.max(0, result.matches.length - 1));
  useEffect(() => { setIndex(0); }, [query, matchCase, source]);
  useEffect(() => {
    const box = pre.current, mark = box?.querySelector<HTMLElement>('[data-current="true"]');
    if (!box || !mark) return;
    const bounds = box.getBoundingClientRect(), target = mark.getBoundingClientRect();
    if (target.top < bounds.top) box.scrollTop += target.top - bounds.top - 8;
    else if (target.bottom > bounds.bottom) box.scrollTop += target.bottom - bounds.bottom + 8;
    if (target.left < bounds.left) box.scrollLeft += target.left - bounds.left - 8;
    else if (target.right > bounds.right) box.scrollLeft += target.right - bounds.right + 8;
  }, [result, current]);
  const step = (direction: -1 | 1) => { if (result.matches.length) setIndex((current + direction + result.matches.length) % result.matches.length); };
  const parts: ReactNode[] = []; let from = 0;
  for (const [at, match] of result.matches.entries()) {
    parts.push(source.slice(from, match.from), <mark key={match.from} data-current={at === current}>{source.slice(match.from, match.to)}</mark>);
    from = match.to;
  }
  parts.push(source.slice(from));
  return <>
    {find && <FileBrowserPreviewFind {...find} current={current} count={result.matches.length} limited={result.limited} step={step} />}
    <pre onScroll={event => { if (position) captureTextPreview(event.currentTarget, position); }} className={wrap ? "file-browser-preview-wrapped" : undefined} ref={pre} tabIndex={0} aria-label="预览文本">{parts}</pre>
  </>;
}
