import { DEFAULT_WORKSPACE_LAYOUT } from "../lib/workspace-layout";
import { documentOpenOptions, type DocumentOpenOptions } from "../lib/document-open";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDocumentPanelPosition } from "../hooks/useDocumentPanelPosition";
import { WORKSPACE_RECENT_CATEGORY_LIMIT, workspaceSummaryShortcutIndex, type WorkspaceDocumentSummary } from "../lib/workspace-summary";
import type { RecentLocalFile } from "../lib/local-files/recent";
import { ToolbarIcon } from "./ToolbarIcon";
import "./WorkspaceSummaryPreview.css";

const ROW_HEIGHT = 28;

/** A metadata-only preview, independent of sidebar widths and editor layout. */
export function WorkspaceSummaryPreview({ title, documents, localFiles = [], showLocalFilesSection = false, trigger, keyboard, numbered = false, reverseNumbering = false, editedIds, visibleRows = DEFAULT_WORKSPACE_LAYOUT.summaryVisibleRows, compact = false, onOpen, onOpenLocal, onClose, onEnter, onLeave }: {
  title: string;
  documents: WorkspaceDocumentSummary[];
  localFiles?: RecentLocalFile[];
  showLocalFilesSection?: boolean;
  trigger: HTMLButtonElement;
  keyboard: boolean;
  numbered?: boolean;
  reverseNumbering?: boolean;
  editedIds?: string[];
  visibleRows?: number;
  compact?: boolean;
  onOpen: (id: string, options?: DocumentOpenOptions) => void;
  onOpenLocal?: (file: RecentLocalFile) => void;
  onClose: (restoreFocus?: boolean) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;
  const handlers = useRef({ onClose, onOpen, documents, numbered, reverseNumbering });
  handlers.current = { onClose, onOpen, documents, numbered, reverseNumbering };
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(ROW_HEIGHT * visibleRows);
  const [focusIndex, setFocusIndex] = useState<number | null>(keyboard ? numbered && !reverseNumbering ? documents.length - 1 : 0 : null);
  const previousKeyboard = useRef(keyboard);
  useLayoutEffect(() => {
    if (keyboard && !previousKeyboard.current) setFocusIndex(numbered && !reverseNumbering ? documents.length - 1 : 0);
    previousKeyboard.current = keyboard;
  }, [keyboard, numbered, reverseNumbering, documents.length]);
  const rowsPerGroup = showLocalFilesSection ? Math.min(WORKSPACE_RECENT_CATEGORY_LIMIT, visibleRows) : visibleRows;
  const previewHeight = ROW_HEIGHT * rowsPerGroup * (showLocalFilesSection ? 2 : 1) + (showLocalFilesSection ? 96 : 46);
  const style = useDocumentPanelPosition({ open: true, triggerRef, panelRef, compact, layoutKey: `${visibleRows}:${showLocalFilesSection}`, heightLimit: previewHeight, viewportHeightRatio: showLocalFilesSection ? 0.72 : 0.58 });
  const virtual = documents.length > 60;
  const start = virtual ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4) : 0;
  const end = virtual ? Math.min(documents.length, start + Math.ceil(height / ROW_HEIGHT) + 8) : documents.length;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => setHeight(list.clientHeight));
    observer.observe(list);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!numbered || !list) return;
    list.scrollTop = reverseNumbering ? 0 : list.scrollHeight;
    setScrollTop(list.scrollTop);
  }, [numbered, reverseNumbering, documents.length]);
  useLayoutEffect(() => {
    if (focusIndex === null || style?.visibility !== "visible") return;
    const target = listRef.current?.querySelector<HTMLButtonElement>(`[data-summary-index="${focusIndex}"]`);
    if (target) { target.focus({ preventScroll: true }); setFocusIndex(null); }
    else if (!documents.length) { panelRef.current?.focus({ preventScroll: true }); setFocusIndex(null); }
  }, [focusIndex, start, end, style?.visibility, documents.length]);
  useEffect(() => {
    const outside = (event: Event) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target) && !trigger.contains(event.target)) handlers.current.onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); handlers.current.onClose(true); }
      else if (handlers.current.numbered && !event.isComposing && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
        // A hover preview must never consume normal typing in an editor/search.
        if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true], [role=textbox]")) return;
        const index = workspaceSummaryShortcutIndex(event.key);
        const documentIndex = index === null ? null : handlers.current.reverseNumbering ? handlers.current.documents.length - 1 - index : index;
        const note = documentIndex === null ? undefined : handlers.current.documents[documentIndex];
        if (!note) return;
        event.preventDefault(); event.stopImmediatePropagation();
        handlers.current.onOpen(note.id);
      }
    };
    const blur = () => handlers.current.onClose();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", blur);
    };
  }, [trigger]);
  return createPortal(<div ref={panelRef} className="workspace-summary-preview" style={style} role="dialog" aria-label={`${title}预览`} tabIndex={-1}
    onPointerEnter={onEnter} onPointerLeave={onLeave}>
    <div className="workspace-summary-preview-heading"><strong>{title}<span>{documents.length + localFiles.length}</span></strong>
      {numbered && <kbd className="workspace-summary-shortcut-hint" title="输入行首十六进制编号直接打开文档">{documents.length ? `0–${Math.min(15, documents.length - 1).toString(16)}` : "0–f"}</kbd>}
      <button type="button" aria-label="关闭文档预览" onClick={() => onClose(true)}><ToolbarIcon name="close" /></button>
    </div>
    {(showLocalFilesSection || localFiles.length > 0) && <h4 className="workspace-summary-preview-section-title">Nine Rings 文档</h4>}
    {documents.length > 0 && <>
    <ul ref={listRef} style={{ maxHeight: ROW_HEIGHT * rowsPerGroup + 8 }} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={event => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const current = Number((event.target as HTMLElement).closest<HTMLElement>("[data-summary-index]")?.dataset.summaryIndex ?? 0);
        const index = event.key === "Home" ? 0 : event.key === "End" ? documents.length - 1 : Math.max(0, Math.min(documents.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
        event.preventDefault();
        const list = event.currentTarget;
        const top = index * ROW_HEIGHT + 4;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight) list.scrollTop = top + ROW_HEIGHT - list.clientHeight;
        setScrollTop(list.scrollTop);
        // Focus after React mounts the target row, before the browser restores
        // focus/scroll around a row removed by virtualization.
        setFocusIndex(index);
      }}>
      {start > 0 && <li aria-hidden="true" style={{ height: start * ROW_HEIGHT }} />}
      {documents.slice(start, end).map((note, offset) => <li key={note.id}>
        <button type="button" data-summary-index={start + offset} aria-label={note.title || "未命名文档"} data-edit-status={editedIds ? editedIds.includes(note.id) ? "edited" : "viewed" : undefined} aria-description={editedIds ? editedIds.includes(note.id) ? "已记录编辑" : "仅浏览，尚未记录编辑" : undefined} title={`${note.title || "未命名文档"}${editedIds ? editedIds.includes(note.id) ? " — 已记录编辑" : " — 仅浏览，尚未记录编辑" : ""}`} onClick={event => onOpen(note.id, documentOpenOptions(event))}>{numbered && <span aria-hidden="true" className="workspace-summary-shortcut">{(reverseNumbering ? documents.length - 1 - (start + offset) : start + offset).toString(16)}</span>}{note.title || "未命名文档"}</button>
      </li>)}
      {end < documents.length && <li aria-hidden="true" style={{ height: (documents.length - end) * ROW_HEIGHT }} />}
    </ul></>}
    {showLocalFilesSection && documents.length === 0 && <p className="workspace-summary-preview-local-empty">暂无最近打开的 Nine Rings 文档</p>}
    {showLocalFilesSection && <h4 className="workspace-summary-preview-section-title">本地文件</h4>}
    {localFiles.length > 0 && <>
      <ul className="workspace-summary-preview-local-list" style={{ maxHeight: ROW_HEIGHT * Math.min(rowsPerGroup, localFiles.length) + 8 }}>
        {localFiles.slice(0, WORKSPACE_RECENT_CATEGORY_LIMIT).map(file => <li key={`${file.rootId}:${file.nodeId}`}>
          <button type="button" className="workspace-summary-preview-local-file" title={`${file.rootName}/${file.nodeId}`} onClick={() => onOpenLocal?.(file)}>
            <ToolbarIcon name="disk" /><span>{file.name}</span><small>{file.rootName}</small>
          </button>
        </li>)}
      </ul>
    </>}
    {showLocalFilesSection && localFiles.length === 0 && <p className="workspace-summary-preview-local-empty">暂无本地文件记录</p>}
    {!documents.length && !localFiles.length && !showLocalFilesSection && <p className="workspace-summary-preview-empty">暂无记录</p>}
  </div>, document.body);
}
