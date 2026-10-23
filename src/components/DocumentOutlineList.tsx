import { usePanelDisplay } from "../hooks/usePanelDisplay";
import { panelDisplays, type PanelDisplayContribution } from "../lib/plugin-system/panel-display";
import { ToolbarIcon } from "./ToolbarIcon";
import { outlineLabel } from "../lib/heading-links";
import { EditorFoldIcon } from "./EditorFoldIcon";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type CSSProperties,
} from "react";
import type { DocumentOutlineItem } from "../lib/document-outline";

export interface VisibleOutlineEntry {
  item: DocumentOutlineItem;
  /** 在完整目录中的索引，用于当前章节定位。 */
  index: number;
  folded: boolean;
  foldable: boolean;
}

interface DocumentOutlineListProps {
  entries: VisibleOutlineEntry[];
  activeOutlineIndex: number;
  followActive?: boolean;
  outlineBaseLevel: number;
  listRef: MutableRefObject<HTMLDivElement | null>;
  onToggleFold: (position: number) => void;
  onJump: (item: DocumentOutlineItem) => void;
  compactSymbols?: boolean;
  displayTarget?: "document-outline" | "source-symbols";
}

const VIRTUALIZE_AFTER = 100;
const SINGLE_ROW_HEIGHT = 26;
const COMPACT_SYMBOL_ROW_HEIGHT = 22;
// Two lines at the mobile navigation line-height plus vertical padding. Keep
// enough room before the first measurement arrives; a fixed 42px row lets a
// wrapped title paint over the following virtualized row on WebKit.
const WRAPPED_ROW_HEIGHT = 48;
// .document-outline-item 的 padding-block 固定为 3px（上下各 3px）。测量内容
// 元素的自然高度后需加回这段固定垂直内边距，才是行的真实自然高度。
const VERTICAL_PADDING = 6;
const COMPACT_VERTICAL_PADDING = 2;
const DEFAULT_LIST_WIDTH = 360;
const OVERSCAN_PX = SINGLE_ROW_HEIGHT * 8;
// Session objects only: reopening an unchanged outline reuses size estimates.
// Weak keys let closed/encrypted document data be collected; nothing is persisted.
const rowEstimateCache = new WeakMap<DocumentOutlineItem, Map<string, number>>();
export const OUTLINE_SCROLL_EVENT = "nine-rings:outline-scroll";

function entryKey(entry: VisibleOutlineEntry): string {
  return `${entry.index}:${entry.item.pos}:${outlineLabel(entry.item.displayText ?? entry.item.text)}`;
}

function outlineText(item: DocumentOutlineItem): string {
  return item.displayText ?? item.text;
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
  return width * (13 / 12);
}

function estimatedRowHeight(
  entry: VisibleOutlineEntry,
  outlineBaseLevel: number,
  listWidth: number,
  display: PanelDisplayContribution | null,
  compactSymbols: boolean,
): number {
  const cacheKey = `${outlineBaseLevel}:${listWidth}:${display?.font}:${display?.fontSize}:${display?.rowHeight}:${display?.showMetadata}:${compactSymbols}`;
  const cached = rowEstimateCache.get(entry.item);
  const existing = cached?.get(cacheKey);
  if (existing !== undefined) return existing;
  const indentation = Math.max(0, entry.item.level - outlineBaseLevel) * 14;
  // 行内固定区域：左缩进、折叠按钮、Hn 标签、间距及右内边距。
  const availableTextWidth = Math.max(80, listWidth - indentation - 60);
  const scale = (display?.fontSize ?? 13) / 13;
  const singleHeight = compactSymbols ? COMPACT_SYMBOL_ROW_HEIGHT : SINGLE_ROW_HEIGHT;
  const wrappedHeight = compactSymbols ? 42 : WRAPPED_ROW_HEIGHT;
  const height = Math.max(display?.rowHeight ?? 0, approximateTextWidth(outlineLabel(outlineText(entry.item))) * scale > availableTextWidth
    ? wrappedHeight * scale
    : singleHeight * scale);
  const sizes = cached ?? new Map<string, number>();
  if (sizes.size >= 4) sizes.clear();
  sizes.set(cacheKey, height);
  rowEstimateCache.set(entry.item, sizes);
  return height;
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
  followActive = false,
  outlineBaseLevel,
  listRef,
  onToggleFold,
  onJump,
  compactSymbols = false,
  displayTarget = "document-outline",
}: DocumentOutlineListProps) {
  const display = usePanelDisplay(displayTarget);
  const minimumHeight = display ? Math.max(display.rowHeight, window.matchMedia("(max-width: 768px), (pointer: coarse)").matches ? 36 : 0) : compactSymbols ? COMPACT_SYMBOL_ROW_HEIGHT : SINGLE_ROW_HEIGHT;
  const paths = useMemo(() => {
    if (display?.tooltip !== "path") return [];
    const ancestors: string[] = [];
    return entries.map(({ item }) => {
      ancestors.length = item.level - 1;
      ancestors[item.level - 1] = outlineLabel(outlineText(item), 500);
      return ancestors.filter(Boolean).join(" / ");
    });
  }, [entries, display?.tooltip]);
  const virtualized = entries.length > VIRTUALIZE_AFTER;
  const [windowRange, setWindowRange] = useState(() => initialWindow(entries, activeOutlineIndex));
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH);
  const [measuredHeights, setMeasuredHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const frameRef = useRef(0);
  const listWidthRef = useRef(DEFAULT_LIST_WIDTH);
  const measuredHeightsRef = useRef(new Map<string, number>());
  const rowObserverRef = useRef<ResizeObserver | null>(null);
  const observedRowsRef = useRef(new Set<Element>());
  const navigationTargetRef = useRef<"top" | "middle" | "bottom" | "current" | null>(null);

  const rowLayout = useMemo(() => {
    const tops: number[] = [];
    const heights: number[] = [];
    let totalHeight = 0;
    for (const entry of entries) {
      const height = measuredHeights.get(entryKey(entry))
        ?? Math.max(minimumHeight, estimatedRowHeight(entry, outlineBaseLevel, listWidth, display, compactSymbols));
      tops.push(totalHeight);
      heights.push(height);
      totalHeight += height;
    }
    return { tops, heights, totalHeight };
  }, [entries, measuredHeights, listWidth, outlineBaseLevel, display, minimumHeight, compactSymbols]);
  const rowLayoutRef = useRef(rowLayout);
  rowLayoutRef.current = rowLayout;

  const navigationContextRef = useRef({ entries, activeOutlineIndex, virtualized });
  navigationContextRef.current = { entries, activeOutlineIndex, virtualized };
  const applyNavigation = useCallback(() => {
    const list = listRef.current;
    const target = navigationTargetRef.current;
    if (!list || !target) return;
    const maximum = Math.max(0, list.scrollHeight - list.clientHeight);
    let currentTop: number | undefined;
    if (target === "current") {
      const context = navigationContextRef.current;
      const currentIndex = context.entries.findIndex(entry => entry.index === context.activeOutlineIndex);
      const currentRow = list.querySelector<HTMLElement>(`[data-outline-index="${context.activeOutlineIndex}"]`);
      currentTop = context.virtualized ? rowLayoutRef.current.tops[currentIndex] : currentRow ? currentRow.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop : undefined;
    }
    const top = target === "current" ? Math.max(0, (currentTop ?? list.scrollTop) - list.clientHeight / 2) : target === "top" ? 0 : target === "middle" ? maximum / 2 : maximum;
    if (Math.abs(list.scrollTop - top) > 0.5) list.scrollTop = top;
  }, [listRef]);

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

  const followedIndexRef = useRef(activeOutlineIndex);
  useLayoutEffect(() => {
    if (!followActive) return;
    if (followedIndexRef.current !== activeOutlineIndex) {
      navigationTargetRef.current = null;
      followedIndexRef.current = activeOutlineIndex;
    }
    const index = entries.findIndex(entry => entry.index === activeOutlineIndex);
    const list = listRef.current;
    if (!list || index < 0) return;
    const reveal = () => {
      if (navigationTargetRef.current) return;
      const { tops, heights } = rowLayoutRef.current;
      const top = tops[index], height = heights[index];
      if (top < list.scrollTop || top + height > list.scrollTop + list.clientHeight) {
        list.scrollTop = Math.max(0, top - (list.clientHeight - height) / 2);
        scheduleWindowUpdate();
      }
    };
    reveal();
    const frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [activeOutlineIndex, entries, followActive, listRef, scheduleWindowUpdate]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const navigate = (event: Event) => {
      const target = (event as CustomEvent<string>).detail;
      if (target !== "top" && target !== "middle" && target !== "bottom" && target !== "current") return;
      navigationTargetRef.current = target;
      applyNavigation();
      scheduleWindowUpdate();
    };
    const cancel = () => { navigationTargetRef.current = null; };
    const inputs = ["wheel", "touchstart", "pointerdown", "keydown"];
    list.addEventListener(OUTLINE_SCROLL_EVENT, navigate);
    inputs.forEach(name => list.addEventListener(name, cancel, { passive: true }));
    return () => {
      list.removeEventListener(OUTLINE_SCROLL_EVENT, navigate);
      inputs.forEach(name => list.removeEventListener(name, cancel));
      navigationTargetRef.current = null;
    };
  }, [applyNavigation, listRef, scheduleWindowUpdate]);

  useLayoutEffect(() => {
    applyNavigation();
    if (!virtualized) return;
    // 首次挂载先保留当前章节附近的窗口，让父级可以立即测量并居中；
    // 下一帧再根据实际 scrollTop 收敛到可视范围。
    const frame = requestAnimationFrame(updateWindow);
    return () => {
      cancelAnimationFrame(frame);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [activeOutlineIndex, entries.length, measuredHeights, listWidth, updateWindow, virtualized, applyNavigation]);

  useLayoutEffect(() => {
    measuredHeightsRef.current.clear();
    setMeasuredHeights(new Map());
  }, [display]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const updateWidth = () => {
      const width = list.clientWidth;
      if (width <= 0 || Math.abs(listWidthRef.current - width) < 1) return;
      listWidthRef.current = width;
      measuredHeightsRef.current.clear();
      setMeasuredHeights(new Map());
      setListWidth(width);
    };
    updateWidth();
    const observer = new ResizeObserver(() => {
      updateWidth();
      applyNavigation();
      scheduleWindowUpdate();
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [listRef, applyNavigation, scheduleWindowUpdate]);

  useLayoutEffect(() => {
    if (!virtualized || typeof ResizeObserver === "undefined") return;
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver((records) => {
      const layout = rowLayoutRef.current;
      let changed = false;
      let heightDeltaAboveViewport = 0;
      for (const record of records) {
        const row = record.target.closest(".document-outline-item");
        if (!(row instanceof HTMLElement)) continue;
        const key = row.dataset.outlineRowKey;
        const visibleIndex = Number(row.dataset.visibleIndex);
        if (!key || !Number.isInteger(visibleIndex) || visibleIndex < 0) continue;
        // min-height 会把「高估预留」的行撑高，直接测 row 高度得到的是被撑高
        // 的假值（自我实现预言），单行文本因此永远留白。改测内容元素（link）
        // 的自然高度 + 固定垂直 padding，高估的行才能被实测值回缩。
        const measured = Math.max(
          minimumHeight,
          Math.round((record.borderBoxSize?.[0]?.blockSize ?? record.contentRect.height) * 2) / 2 + (compactSymbols ? COMPACT_VERTICAL_PADDING : VERTICAL_PADDING),
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
      // Publish the measured data itself so memoized layout has an explicit dependency.
      setMeasuredHeights(new Map(measuredHeightsRef.current));
    });
    rowObserverRef.current = observer;
    return () => {
      observer.disconnect();
      observedRowsRef.current.clear();
      if (rowObserverRef.current === observer) rowObserverRef.current = null;
    };
  }, [listRef, virtualized, display, minimumHeight, compactSymbols]);

  useLayoutEffect(() => {
    if (!virtualized) return;
    const observer = rowObserverRef.current;
    const list = listRef.current;
    if (!observer || !list) return;
    const nextRows = new Set<Element>();
    list.querySelectorAll<HTMLElement>(".document-outline-item").forEach((row) => {
      // The row's reserved min-height masks content shrinking. Observe the
      // same natural content box we measure, so both growth and shrink notify.
      const content = row.querySelector(".document-outline-link") ?? row;
      nextRows.add(content);
      if (!observedRowsRef.current.has(content)) observer.observe(content);
    });
    for (const row of observedRowsRef.current) {
      if (!nextRows.has(row)) observer.unobserve(row);
    }
    observedRowsRef.current = nextRows;
  }, [entries, listRef, virtualized, windowRange.end, windowRange.start, display]);

  const renderEntry = (entry: VisibleOutlineEntry, visibleIndex: number) => {
    const { item, index, folded } = entry;
    return (
      <div
        key={`${item.pos}-${index}`}
        className={`document-outline-item ${index === activeOutlineIndex ? "current" : ""}`}
        style={{
          paddingInlineStart: `calc(var(--document-outline-leading-inset, 10px) + ${(item.level - outlineBaseLevel) * 14}px)`,
          // Reserve the complete one/two-line row before it enters the DOM.
          // Use min-height so a title that wraps slightly beyond the estimate
          // expands and can be measured instead of painting over the next row.
          // 高估（判两行实为一行）时行的真实高度由 ResizeObserver 测内容元素
          // 回缩，min-height 只是首帧预留，不会把空白固化成永久行高。
          ...(virtualized ? { top: `${rowLayout.tops[visibleIndex]}px`, minHeight: `${rowLayout.heights[visibleIndex]}px` } : {}),
        }}
        data-level={item.level}
        data-symbol-kind={compactSymbols ? item.kind : undefined}
        data-symbol-nested={compactSymbols && item.level > outlineBaseLevel ? "true" : undefined}
        data-hierarchy-level={((item.level - 1) % 6) + 1}
        data-outline-index={index}
        data-compact-symbols={compactSymbols ? "true" : undefined}
        data-outline-row-key={entryKey(entry)}
        data-visible-index={visibleIndex}
        aria-current={index === activeOutlineIndex ? "location" : undefined}
        title={display?.tooltip === "path" ? paths[visibleIndex] : item.detail || outlineLabel(item.text, 500)}
      >
        {entry.foldable ? <button
          className="document-outline-fold"
          type="button"
          aria-label={`${folded ? "展开" : "折叠"}章节 ${outlineLabel(item.text)}`}
          onClick={() => onToggleFold(item.pos)}
          aria-expanded={!folded}
        ><EditorFoldIcon outline expanded={!folded} /></button>
          : <span className="document-outline-fold-placeholder" aria-hidden="true" />}
        <button className="document-outline-link" type="button" onClick={() => onJump(item)} aria-label={item.kind ? `${item.kind}：${item.detail || item.text}` : `H${item.level} ${item.text}`}>
          {display?.showMetadata !== false && <span className={`document-outline-level ${item.kindSymbol ? "is-symbol-marker" : ""}`} aria-hidden="true">{item.kindSymbol ?? item.kind ?? `H${item.level}`}</span>}
          <span className="document-outline-text">{outlineLabel(outlineText(item))}</span>
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
      data-source-symbols={compactSymbols ? "true" : undefined}
      data-panel-display={display ? "plugin" : undefined}
      data-panel-display-target={display ? displayTarget : undefined}
      style={display ? {
        "--outline-display-font": display.font === "mono" ? "var(--font-mono)" : display.font === "sans" ? "var(--font)" : "inherit",
        "--outline-display-font-size": `${display.fontSize}px`,
        "--outline-display-row-height": `${display.rowHeight}px`,
        "--outline-display-color": display.labelColor === "accent" ? "var(--accent)" : display.labelColor === "secondary" ? "var(--text-secondary)" : "inherit",
      } as CSSProperties : undefined}
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

export function OutlineDisplayTools({ listRef, targetLabel = "定位当前标题", target = "document-outline" }: { listRef: MutableRefObject<HTMLDivElement | null>; targetLabel?: string; target?: "document-outline" | "source-symbols" }) {
  const display = usePanelDisplay(target);
  return <>{display?.toolbar.map(itemCommand => <button key={itemCommand} type="button" title={targetLabel} aria-label={targetLabel} data-panel-display-command={itemCommand}
    onClick={() => panelDisplays.run(target, display, itemCommand, {
      "outline.reveal-current": () => listRef.current?.dispatchEvent(new CustomEvent(OUTLINE_SCROLL_EVENT, { detail: "current" })),
      "source-symbols.reveal-current": () => listRef.current?.dispatchEvent(new CustomEvent(OUTLINE_SCROLL_EVENT, { detail: "current" })),
    })}><ToolbarIcon name={target === "source-symbols" ? "focus" : "search"} /></button>)}</>;
}
