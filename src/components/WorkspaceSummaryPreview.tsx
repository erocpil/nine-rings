import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDocumentPanelPosition } from "../hooks/useDocumentPanelPosition";
import { workspaceSummaryShortcutIndex, type WorkspaceDocumentSummary } from "../lib/workspace-summary";
import { ToolbarIcon } from "./ToolbarIcon";
import "./WorkspaceSummaryPreview.css";

const ROW_HEIGHT = 28;

/** A metadata-only preview, independent of sidebar widths and editor layout. */
export function WorkspaceSummaryPreview({ title, documents, trigger, keyboard, numbered = false, editedIds, visibleRows = 15, compact = false, onOpen, onClose, onEnter, onLeave }: {
  title: string;
  documents: WorkspaceDocumentSummary[];
  trigger: HTMLButtonElement;
  keyboard: boolean;
  numbered?: boolean;
  editedIds?: string[];
  visibleRows?: number;
  compact?: boolean;
  onOpen: (id: string) => void;
  onClose: (restoreFocus?: boolean) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;
  const handlers = useRef({ onClose, onOpen, documents, numbered });
  handlers.current = { onClose, onOpen, documents, numbered };
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(ROW_HEIGHT * visibleRows);
  const [focusIndex, setFocusIndex] = useState<number | null>(keyboard ? numbered ? documents.length - 1 : 0 : null);
  const previousKeyboard = useRef(keyboard);
  useLayoutEffect(() => {
    if (keyboard && !previousKeyboard.current) setFocusIndex(numbered ? documents.length - 1 : 0);
    previousKeyboard.current = keyboard;
  }, [keyboard, numbered, documents.length]);
  const style = useDocumentPanelPosition({ open: true, triggerRef, panelRef, compact, layoutKey: String(visibleRows), heightLimit: ROW_HEIGHT * visibleRows + 46 });
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
    list.scrollTop = list.scrollHeight;
    setScrollTop(list.scrollTop);
  }, [numbered, documents.length]);
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
        const note = index === null ? undefined : handlers.current.documents[index];
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
    <div className="workspace-summary-preview-heading"><strong>{title}<span>{documents.length}</span></strong>
      {numbered && <kbd className="workspace-summary-shortcut-hint" title="输入行首十六进制编号直接打开文档">0–f</kbd>}
      <button type="button" aria-label="关闭文档预览" onClick={() => onClose(true)}><ToolbarIcon name="close" /></button>
    </div>
    {documents.length ? <ul ref={listRef} style={{ maxHeight: ROW_HEIGHT * visibleRows + 8 }} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
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
        <button type="button" data-summary-index={start + offset} aria-label={note.title || "未命名文档"} data-edit-status={editedIds ? editedIds.includes(note.id) ? "edited" : "viewed" : undefined} aria-description={editedIds ? editedIds.includes(note.id) ? "已记录编辑" : "仅浏览，尚未记录编辑" : undefined} title={`${note.title || "未命名文档"}${editedIds ? editedIds.includes(note.id) ? " — 已记录编辑" : " — 仅浏览，尚未记录编辑" : ""}`} onClick={() => onOpen(note.id)}>{numbered && <span aria-hidden="true" className="workspace-summary-shortcut">{(start + offset).toString(16)}</span>}{note.title || "未命名文档"}</button>
      </li>)}
      {end < documents.length && <li aria-hidden="true" style={{ height: (documents.length - end) * ROW_HEIGHT }} />}
    </ul> : <p className="workspace-summary-preview-empty">暂无文档</p>}
  </div>, document.body);
}
