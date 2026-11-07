import { useRef } from "react";
import type { BrowserColumn, BrowserColumns } from "../lib/local-files/browser-preferences";
import type { LocalFileSort } from "../lib/local-files/tree";

export function FileBrowserColumnHeaders({ columns, sort, width, scrollLeft, onSort, onResize, onReset }: {
  columns: BrowserColumns; sort: LocalFileSort; width: number; scrollLeft: number;
  onSort: (column: BrowserColumn) => void; onResize: (column: BrowserColumn, width: number) => void; onReset: (column: BrowserColumn) => void;
}) {
  const drag = useRef<{ column: BrowserColumn; x: number; width: number } | null>(null);
  const minWidth = columns.name + columns.size + columns.modified + 36;
  const definitions = [{ key: "name", label: "名称" }, { key: "size", label: "大小" }, { key: "modified", label: "修改时间" }] as const;
  return <div className="file-browser-column-viewport"><div className="file-browser-columns" style={{ width: Math.max(minWidth, width), transform: `translateX(${-scrollLeft}px)` }}>
    {definitions.map(column => <span key={column.key} className="file-browser-column">
      <button type="button" aria-label={`按${column.label}排序`} aria-pressed={sort === column.key || sort === `${column.key}-desc`} onClick={() => onSort(column.key)}>{column.label}{sort === column.key ? " ↑" : sort === `${column.key}-desc` ? " ↓" : ""}</button>
      <span role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`调整${column.label}列宽`}
        aria-valuenow={column.key === "name" && columns.autoName ? Math.max(columns.name, width - columns.size - columns.modified - 36) : columns[column.key]}
        title="拖动或方向键调整；双击恢复默认" onDoubleClick={() => onReset(column.key)}
        onPointerDown={event => {
          event.preventDefault(); event.stopPropagation();
          drag.current = { column: column.key, x: event.clientX, width: event.currentTarget.parentElement!.getBoundingClientRect().width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => { if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) onResize(drag.current.column, drag.current.width + event.clientX - drag.current.x); }}
        onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { drag.current = null; }}
        onKeyDown={event => {
          if (event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          onResize(column.key, event.currentTarget.parentElement!.getBoundingClientRect().width + (event.key === "ArrowLeft" ? -8 : 8));
        }} />
    </span>)}
  </div></div>;
}
