import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { browserPreviewMatches, type PreviewScrollPosition } from "../lib/local-files/browser-preview";
import { captureTextPreview, restoreTextPreview } from "../lib/preview-scroll-position";
import { ToolbarIcon } from "./ToolbarIcon";

export function FileBrowserPreviewText({ position, wrap, source, query, onQuery, matchCase, onCase, findOpen, onCloseFind }: {
  position?: PreviewScrollPosition; wrap: boolean; source: string; query: string; onQuery: (query: string) => void; matchCase: boolean; onCase: (value: boolean) => void; findOpen: boolean; onCloseFind: () => void;
}) {
  const [index, setIndex] = useState(0);
  const pre = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => { if (pre.current && position) restoreTextPreview(pre.current, position); }, [position, source]);
  const result = useMemo(() => browserPreviewMatches(source, findOpen ? query : "", matchCase), [source, query, findOpen, matchCase]);
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
    {findOpen && <div className="file-browser-preview-find" role="search" aria-label="预览内查找" onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCloseFind(); }
      else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); step(event.shiftKey ? -1 : 1); }
    }}>
      <input type="search" aria-label="查找预览文本" placeholder="仅查找已预览内容" maxLength={256} value={query} onChange={event => onQuery(event.target.value)} />
      <button type="button" aria-label="预览查找区分大小写" aria-pressed={matchCase} title="区分大小写" onClick={() => onCase(!matchCase)}>Aa</button>
      <span role="status">{result.matches.length ? `${current + 1}/${result.matches.length}${result.limited ? "+" : ""}` : "0/0"}</span>
      <button type="button" className="btn-icon" aria-label="上一个预览匹配" disabled={!result.matches.length} onClick={() => step(-1)}><ToolbarIcon name="chevronLeft" /></button>
      <button type="button" className="btn-icon" aria-label="下一个预览匹配" disabled={!result.matches.length} onClick={() => step(1)}><ToolbarIcon name="chevronRight" /></button>
      <button type="button" className="btn-icon" aria-label="关闭预览查找" onClick={onCloseFind}><ToolbarIcon name="close" /></button>
    </div>}
    <pre onScroll={event => { if (position) captureTextPreview(event.currentTarget, position); }} className={wrap ? "file-browser-preview-wrapped" : undefined} ref={pre} tabIndex={0} aria-label="预览文本">{parts}</pre>
  </>;
}
