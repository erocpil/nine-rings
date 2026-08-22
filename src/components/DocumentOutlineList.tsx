import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { DocumentOutlineItem } from "../lib/document-outline";

export interface VisibleOutlineEntry {
  item: DocumentOutlineItem;
  /** 在完整目录中的索引，用于当前章节定位。 */
  index: number;
  folded: boolean;
}

interface DocumentOutlineListProps {
  entries: VisibleOutlineEntry[];
  activeOutlineIndex: number;
  outlineBaseLevel: number;
  listRef: MutableRefObject<HTMLDivElement | null>;
  onToggleFold: (position: number) => void;
  onJump: (item: DocumentOutlineItem) => void;
}

const VIRTUALIZE_AFTER = 100;
const SINGLE_ROW_HEIGHT = 26;
const WRAPPED_ROW_HEIGHT = 39;
const DEFAULT_LIST_WIDTH = 360;
const OVERSCAN_PX = SINGLE_ROW_HEIGHT * 8;

function entryKey(entry: VisibleOutlineEntry): string {
  return `${entry.index}:${entry.item.pos}:${entry.item.text}`;
}

function approximateTextWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (/\s/u.test(character)) width += 3.5;
    else if (codePoint > 0x7f) width += 12;
    else if (/[ilI1.,:;'`|!]/u.test(character)) width += 3.5;
    else if (/[MW@#%&]/u.test(character)) width += 9;
    else width += 6.5;
  }
  return width;
}

function estimatedRowHeight(
  entry: VisibleOutlineEntry,
  outlineBaseLevel: number,
  listWidth: number,
): number {
  const indentation = Math.max(0, entry.item.level - outlineBaseLevel) * 14;
  // 行内固定区域：左缩进、折叠按钮、Hn 标签、间距及右内边距。
  const availableTextWidth = Math.max(80, listWidth - indentation - 60);
  return approximateTextWidth(entry.item.text) > availableTextWidth
    ? WRAPPED_ROW_HEIGHT
    : SINGLE_ROW_HEIGHT;
}

function firstRowEndingAfter(
  tops: readonly number[],
  heights: readonly number[],
  offset: number,
): number {
  let low = 0;
  let high = tops.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (tops[middle] + heights[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function initialWindow(entries: VisibleOutlineEntry[], activeOutlineIndex: number) {
  const activeVisibleIndex = Math.max(0, entries.findIndex((entry) => entry.index === activeOutlineIndex));
  const start = Math.max(0, activeVisibleIndex - 16);
  return { start, end: Math.min(entries.length, start + 40) };
}

/**
 * 大目录只挂载视口附近的标题。文档可以有数千个标题，但打开目录时
 * React/DOM 节点数量维持在几十个，滚动时也只替换小窗口。
 */
export const DocumentOutlineList = memo(function DocumentOutlineList({
  entries,
  activeOutlineIndex,
  outlineBaseLevel,
  listRef,
  onToggleFold,
  onJump,
}: DocumentOutlineListProps) {
  const virtualized = entries.length > VIRTUALIZE_AFTER;
  const [windowRange, setWindowRange] = useState(() => initialWindow(entries, activeOutlineIndex));
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH);
  const [heightRevision, setHeightRevision] = useState(0);
  const frameRef = useRef(0);
  const listWidthRef = useRef(DEFAULT_LIST_WIDTH);
  const measuredHeightsRef = useRef(new Map<string, number>());
  const rowObserverRef = useRef<ResizeObserver | null>(null);

  const rowLayout = useMemo(() => {
    const tops: number[] = [];
    const heights: number[] = [];
    let totalHeight = 0;
    for (const entry of entries) {
      const height = measuredHeightsRef.current.get(entryKey(entry))
        ?? estimatedRowHeight(entry, outlineBaseLevel, listWidth);
      tops.push(totalHeight);
      heights.push(height);
      totalHeight += height;
    }
    return { tops, heights, totalHeight };
  }, [entries, heightRevision, listWidth, outlineBaseLevel]);
  const rowLayoutRef = useRef(rowLayout);
  rowLayoutRef.current = rowLayout;

  const updateWindow = useCallback(() => {
    frameRef.current = 0;
    if (!virtualized) return;
    const list = listRef.current;
    if (!list) return;
    const { tops, heights } = rowLayoutRef.current;
    const start = Math.min(
      entries.length,
      firstRowEndingAfter(tops, heights, Math.max(0, list.scrollTop - OVERSCAN_PX)),
    );
    const overscanBottom = list.scrollTop + list.clientHeight + OVERSCAN_PX;
    let end = start;
    while (end < entries.length && tops[end] < overscanBottom) end += 1;
    setWindowRange((current) => current.start === start && current.end === end
      ? current
      : { start, end });
  }, [entries.length, listRef, virtualized]);

  const scheduleWindowUpdate = useCallback(() => {
    if (!virtualized || frameRef.current) return;
    frameRef.current = requestAnimationFrame(updateWindow);
  }, [updateWindow, virtualized]);

  useLayoutEffect(() => {
    if (!virtualized) return;
    // 首次挂载先保留当前章节附近的窗口，让父级可以立即测量并居中；
    // 下一帧再根据实际 scrollTop 收敛到可视范围。
    const frame = requestAnimationFrame(updateWindow);
    return () => {
      cancelAnimationFrame(frame);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [activeOutlineIndex, entries.length, heightRevision, listWidth, updateWindow, virtualized]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const updateWidth = () => {
      const width = list.clientWidth;
      if (width <= 0 || Math.abs(listWidthRef.current - width) < 1) return;
      listWidthRef.current = width;
      measuredHeightsRef.current.clear();
      setListWidth(width);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(list);
    return () => observer.disconnect();
  }, [listRef]);

  useLayoutEffect(() => {
    if (!virtualized || typeof ResizeObserver === "undefined") return;
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver((records) => {
      const layout = rowLayoutRef.current;
      let changed = false;
      let heightDeltaAboveViewport = 0;
      for (const record of records) {
        const row = record.target;
        if (!(row instanceof HTMLElement)) continue;
        const key = row.dataset.outlineRowKey;
        const visibleIndex = Number(row.dataset.visibleIndex);
        if (!key || !Number.isInteger(visibleIndex) || visibleIndex < 0) continue;
        const borderBox = Array.isArray(record.borderBoxSize)
          ? record.borderBoxSize[0]
          : record.borderBoxSize;
        const measured = Math.max(
          SINGLE_ROW_HEIGHT,
          Math.round((borderBox?.blockSize ?? row.getBoundingClientRect().height) * 2) / 2,
        );
        const previous = measuredHeightsRef.current.get(key) ?? layout.heights[visibleIndex];
        measuredHeightsRef.current.set(key, measured);
        if (!Number.isFinite(previous)) {
          changed = true;
          continue;
        }
        if (Math.abs(previous - measured) < 0.5) continue;
        changed = true;
        if (layout.tops[visibleIndex] + previous <= list.scrollTop + 0.5) {
          heightDeltaAboveViewport += measured - previous;
        }
      }
      if (!changed) return;
      if (heightDeltaAboveViewport !== 0) list.scrollTop += heightDeltaAboveViewport;
      setHeightRevision((revision) => revision + 1);
    });
    rowObserverRef.current = observer;
    return () => {
      observer.disconnect();
      if (rowObserverRef.current === observer) rowObserverRef.current = null;
    };
  }, [listRef, virtualized]);

  useLayoutEffect(() => {
    if (!virtualized) return;
    const observer = rowObserverRef.current;
    const list = listRef.current;
    if (!observer || !list) return;
    observer.disconnect();
    list.querySelectorAll<HTMLElement>(".document-outline-item").forEach((row) => observer.observe(row));
  }, [heightRevision, listRef, virtualized, windowRange.end, windowRange.start]);

  const renderEntry = (entry: VisibleOutlineEntry, visibleIndex: number) => {
    const { item, index, folded } = entry;
    return (
      <div
        key={`${item.pos}-${index}`}
        className={`document-outline-item ${index === activeOutlineIndex ? "current" : ""}`}
        style={{
          paddingInlineStart: `${10 + (item.level - outlineBaseLevel) * 14}px`,
          ...(virtualized ? { top: `${rowLayout.tops[visibleIndex]}px` } : {}),
        }}
        data-level={item.level}
        data-outline-index={index}
        data-outline-row-key={entryKey(entry)}
        data-visible-index={visibleIndex}
        aria-current={index === activeOutlineIndex ? "location" : undefined}
        title={item.text}
      >
        <button
          className="document-outline-fold"
          type="button"
          aria-label={`${folded ? "展开" : "折叠"}章节 ${item.text}`}
          onClick={() => onToggleFold(item.pos)}
        >{folded ? "▶" : "▼"}</button>
        <button className="document-outline-link" type="button" onClick={() => onJump(item)}>
          <span className="document-outline-level">H{item.level}</span>
          <span className="document-outline-text">{item.text}</span>
        </button>
      </div>
    );
  };

  const renderedEntries = virtualized
    ? entries.slice(windowRange.start, windowRange.end)
    : entries;

  return (
    <div
      className={`document-outline-list ${virtualized ? "is-virtualized" : ""}`}
      ref={listRef}
      onScroll={scheduleWindowUpdate}
    >
      {virtualized ? (
        <div
          className="document-outline-window"
          style={{ height: `${rowLayout.totalHeight}px` }}
        >
          {renderedEntries.map((entry, offset) => renderEntry(entry, windowRange.start + offset))}
        </div>
      ) : renderedEntries.map((entry, index) => renderEntry(entry, index))}
    </div>
  );
});
