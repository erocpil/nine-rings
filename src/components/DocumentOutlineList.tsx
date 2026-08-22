import {
  memo,
  useCallback,
  useLayoutEffect,
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
const VIRTUAL_ROW_HEIGHT = 40;
const OVERSCAN_ROWS = 8;

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
  const frameRef = useRef(0);

  const updateWindow = useCallback(() => {
    frameRef.current = 0;
    if (!virtualized) return;
    const list = listRef.current;
    if (!list) return;
    const start = Math.max(0, Math.floor(list.scrollTop / VIRTUAL_ROW_HEIGHT) - OVERSCAN_ROWS);
    const end = Math.min(
      entries.length,
      Math.ceil((list.scrollTop + list.clientHeight) / VIRTUAL_ROW_HEIGHT) + OVERSCAN_ROWS,
    );
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
  }, [activeOutlineIndex, entries.length, updateWindow, virtualized]);

  const renderEntry = (entry: VisibleOutlineEntry, visibleIndex: number) => {
    const { item, index, folded } = entry;
    return (
      <div
        key={`${item.pos}-${index}`}
        className={`document-outline-item ${index === activeOutlineIndex ? "current" : ""}`}
        style={{
          paddingInlineStart: `${10 + (item.level - outlineBaseLevel) * 14}px`,
          ...(virtualized ? { top: `${visibleIndex * VIRTUAL_ROW_HEIGHT}px` } : {}),
        }}
        data-level={item.level}
        data-outline-index={index}
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
          style={{ height: `${entries.length * VIRTUAL_ROW_HEIGHT}px` }}
        >
          {renderedEntries.map((entry, offset) => renderEntry(entry, windowRange.start + offset))}
        </div>
      ) : renderedEntries.map((entry, index) => renderEntry(entry, index))}
    </div>
  );
});
