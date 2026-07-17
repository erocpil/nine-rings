import { useRef, useState, useEffect } from "react";
import type { Note } from "../types/models";
import { TagFilter } from "./TagFilter";
import { api } from "../lib/api";
import { TemplatePicker } from "./TemplatePicker";
import type { Template } from "../lib/storage/template-store";

type SortMode = "manual" | "created" | "updated" | "title";
const SORT_MODE_KEY = "nr:sortMode";

function loadSortMode(): SortMode {
  try { return (localStorage.getItem(SORT_MODE_KEY) as SortMode) || "manual"; } catch { return "manual"; }
}

function saveSortMode(mode: SortMode) {
  try { localStorage.setItem(SORT_MODE_KEY, mode); } catch { /* noop */ }
}

function applySort(notes: Note[], mode: SortMode): Note[] {
  const sorted = [...notes];
  switch (mode) {
    case "manual":
      sorted.sort((a, b) => {
        const pa = a.pinned ? 1 : 0;
        const pb = b.pinned ? 1 : 0;
        if (pb !== pa) return pb - pa;
        const sa = a.sort_order ?? 0;
        const sb = b.sort_order ?? 0;
        if (sa !== sb) return sa - sb;
        return (a.created_at ?? "").localeCompare(b.created_at ?? "");
      });
      break;
    case "created":
      sorted.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      break;
    case "updated":
      sorted.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
      break;
    case "title":
      sorted.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
      break;
  }
  return sorted;
}

const SORT_LABELS: Record<SortMode, string> = {
  manual: "手动",
  created: "创建时间",
  updated: "修改时间",
  title: "标题",
};

interface SidebarProps {
  notes: Note[];
  selectedId: string | null;
  activeTag: string | null;
  onHide: () => void;
  onSelect: (note: Note) => void;
  onCreate: () => void;
  onCreateWithTemplate: (template: Template) => void;
  onDelete: (id: string) => void;
  onReorder: (id: string, sortOrder: number) => void;
  onMoveToDate: (id: string, date: string) => void;
  onTagSelect: (tag: string | null) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onRename: (id: string, title: string) => void;
  onToggleReadonly: (id: string, readonly: boolean) => void;
  sidebarRefreshKey?: number;
  disabled?: boolean;
}

let _dragId: string | null = null;
let _dragIndex: number = -1;

export function Sidebar({
  notes, selectedId, activeTag, onHide, onSelect, onCreate, onCreateWithTemplate,
  onDelete, onReorder, onMoveToDate,
  onTagSelect, onTogglePin, onRename, onToggleReadonly, sidebarRefreshKey, disabled,
}: SidebarProps) {
  const [moveNoteId, setMoveNoteId] = useState<string | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const moveInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ── 模板选择器 ──
  const [templateOpen, setTemplateOpen] = useState(false);
  const newBtnRef = useRef<HTMLButtonElement>(null);

  // ── 多选状态 ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<number>(-1);
  const isMultiSelect = selectedIds.size > 0;

  // ── Sort ──
  const [sortMode, setSortMode] = useState<SortMode>(loadSortMode);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  const handleSortSelect = (mode: SortMode) => {
    setSortMode(mode);
    saveSortMode(mode);
    setSortOpen(false);
  };

  const [sortBtnRef] = useState(() => (el: HTMLDivElement | null) => {
    if (!el) return;
    const handler = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener("click", handler, { once: true });
  });

  // ── 全部随笔模式 ──
  const [showAll, setShowAll] = useState(false);
  const [allNotes, setAllNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (showAll) {
      api.notes.all().then(setAllNotes).catch(() => setAllNotes([]));
    }
  }, [showAll, sidebarRefreshKey]);

  const displayNotes = showAll ? allNotes : notes;
  const sortedNotes = applySort(displayNotes, sortMode);

  // ── 点击处理：Shift 多选 ──
  const handleItemClick = (e: React.MouseEvent, note: Note, index: number) => {
    if (editingId) return;
    if (e.shiftKey) {
      const last = lastClickedRef.current;
      if (last >= 0) {
        const start = Math.min(last, index);
        const end = Math.max(last, index);
        const newSet = new Set(selectedIds);
        for (let i = start; i <= end; i++) {
          newSet.add(sortedNotes[i].id);
        }
        setSelectedIds(newSet);
      } else {
        setSelectedIds(new Set([note.id]));
      }
      lastClickedRef.current = index;
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const newSet = new Set(selectedIds);
      if (newSet.has(note.id)) {
        newSet.delete(note.id);
      } else {
        newSet.add(note.id);
      }
      if (newSet.size === 0) {
        lastClickedRef.current = -1;
        onSelect(note);
      }
      setSelectedIds(newSet);
      e.preventDefault();
      return;
    }
    // 普通点击：取消多选，单选
    if (isMultiSelect) {
      setSelectedIds(new Set());
      lastClickedRef.current = -1;
    }
    lastClickedRef.current = index;
    onSelect(note);
  };

  // ── 取消多选 ──
  const clearSelection = () => {
    setSelectedIds(new Set());
    lastClickedRef.current = -1;
  };

  // ── 批量操作 ──
  const [batchBusy, setBatchBusy] = useState(false);
  const batchDelete = async () => {
    if (disabled || batchBusy) return;
    if (!confirm(`确定删除 ${selectedIds.size} 篇选中的笔记？`)) return;
    setBatchBusy(true);
    const ids = [...selectedIds];
    try {
      await api.recycle.batch.delete(ids);
      ids.forEach((id) => onDelete(id));
      clearSelection();
    } catch { /* noop */ }
    setBatchBusy(false);
  };

  const batchSetReadonly = async (ro: boolean) => {
    if (disabled || batchBusy) return;
    setBatchBusy(true);
    try {
      await api.recycle.batch.setReadonly([...selectedIds], ro);
      clearSelection();
      window.location.reload();
    } catch { /* noop */ }
    setBatchBusy(false);
  };

  // ── Delete (immediate) ──

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (disabled) return;
    onDelete(id);
  };

  // ── Drag & Drop reorder ──

  const handleDragStart = (id: string, index: number) => {
    if (isMultiSelect) return;
    _dragId = id;
    _dragIndex = index;
  };

  const handleDragEnter = (index: number) => {
    setDragOverIdx(index);
  };

  const handleDragEnd = () => {
    setDragOverIdx(null);
    if (_dragId === null || _dragIndex === -1) return;
    const targetIdx = dragOverIdx;
    if (targetIdx === null || targetIdx === _dragIndex) {
      _dragId = null;
      _dragIndex = -1;
      return;
    }
    const arr = notes.map((n) => n.id);
    const [moved] = arr.splice(_dragIndex, 1);
    arr.splice(targetIdx, 0, moved);
    arr.forEach((id, i) => {
      onReorder(id, i);
    });
    _dragId = null;
    _dragIndex = -1;
  };

  // ── Cross-day move ──

  const handleMoveClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (disabled) return;
    setMoveNoteId(id);
    setTimeout(() => moveInputRef.current?.showPicker?.(), 50);
  };

  const handleMoveDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!moveNoteId) return;
    onMoveToDate(moveNoteId, e.target.value);
    setMoveNoteId(null);
  };

  // ── Rename ──

  const startRename = (note: Note) => {
    if (disabled) return;
    setEditingId(note.id);
    setEditValue(note.title || "");
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const commitRename = () => {
    if (!editingId) return;
    const val = editValue.trim();
    if (val) {
      onRename(editingId, val);
    }
    setEditingId(null);
    setEditValue("");
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditValue("");
  };

  const isInSelected = (id: string) => isMultiSelect && selectedIds.has(id);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>随笔</h2>
        <button
          className={`sidebar-all-btn ${showAll ? "active" : ""}`}
          onClick={disabled ? undefined : () => setShowAll(!showAll)}
          disabled={disabled}
          title={showAll ? "返回当日随笔" : "查看全部随笔"}
        >
          {showAll ? "今日" : "全部"}
        </button>
        <button className="sidebar-hide-btn" onClick={onHide} title="隐藏侧栏"><span className="arrow arrow-left" /></button>
        <div className="sidebar-header-actions">
          <div className="sort-dropdown" ref={sortRef}>
            <button
              className="sort-btn"
              onClick={(e) => { e.stopPropagation(); setSortOpen(!sortOpen); }}
              title="排序方式"
              type="button"
            >
              {SORT_LABELS[sortMode]}
            </button>
            {sortOpen && (
              <div className="sort-dropdown-list" ref={sortBtnRef}>
                {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                  <button
                    key={mode}
                    className={`sort-dropdown-item ${mode === sortMode ? "active" : ""}`}
                    onClick={() => handleSortSelect(mode)}
                    type="button"
                  >
                    {SORT_LABELS[mode]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="btn-new"
            ref={newBtnRef}
            onClick={disabled ? undefined : () => setTemplateOpen(!templateOpen)}
            disabled={disabled}
            title="从模板新建"
          >
            +
          </button>
        </div>
      </div>
      <TagFilter activeTag={activeTag} onTagSelect={onTagSelect} />
      {isMultiSelect && (
        <div className="sidebar-multi-info">
          已选 {selectedIds.size} 篇
          <button className="sidebar-multi-clear" onClick={clearSelection}>取消</button>
        </div>
      )}
      <div className="sidebar-list">
        {sortedNotes.map((note, i) => (
          <div
            key={note.id}
            className={`sidebar-item ${note.id === selectedId ? "active" : ""} ${isInSelected(note.id) ? "selected" : ""} ${note.readonly ? "sidebar-item-ro" : ""} ${dragOverIdx === i ? "drag-over" : ""}`}
            onMouseDown={(e) => handleItemClick(e, note, i)}
            draggable={!isMultiSelect}
            onDragStart={() => !isMultiSelect && handleDragStart(note.id, i)}
            onDragEnter={() => handleDragEnter(i)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
          >
            <div className="sidebar-item-drag">⠿</div>
            <div className="sidebar-item-info">
              {editingId === note.id ? (
                <input
                  ref={renameInputRef}
                  className="sidebar-rename-input"
                  value={editValue}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") cancelRename();
                    e.stopPropagation();
                  }}
                  onBlur={commitRename}
                />
              ) : (
                <div
                  className="sidebar-item-title"
                  title={note.title || "无标题"}
                  onDoubleClick={(e) => {
                    if (isMultiSelect) return;
                    e.stopPropagation();
                    startRename(note);
                  }}
                >
                  {note.readonly && <span className="sidebar-item-ro-icon" title="只读">🔒</span>}
                  {note.title || "无标题"}
                </div>
              )}
              <div className="sidebar-item-time">
                {new Date(note.created_at).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
            {!isMultiSelect && note.pinned && (
              <button
                className="sidebar-item-pin pinned"
                onClick={(e) => {
                  e.stopPropagation();
                  if (disabled) return;
                  onTogglePin(note.id, false);
                }}
                title="取消置顶"
              >
                📌
              </button>
            )}
            {!isMultiSelect && (
              <div className="sidebar-item-actions">
                {!note.pinned && (
                  <button
                    className="sidebar-item-pin"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (disabled) return;
                      onTogglePin(note.id, true);
                    }}
                    title="置顶"
                  >
                    📍
                  </button>
                )}
                <button
                  className="sidebar-item-ro"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (disabled) return;
                    onToggleReadonly(note.id, !note.readonly);
                  }}
                  title={note.readonly ? "取消只读" : "设为只读"}
                >
                  {note.readonly ? "🔓" : "🔒"}
                </button>
                <button
                  className="sidebar-item-move"
                  onClick={(e) => handleMoveClick(e, note.id)}
                  title="移至其他日期"
                >
                  📅
                </button>
                <button
                  className="sidebar-item-del"
                  onClick={(e) => handleDelete(e, note.id)}
                  title="删除"
                >
                  🗑
                </button>
              </div>
            )}
          </div>
        ))}
        {notes.length === 0 && (
          <div className="sidebar-empty">今天还没有笔记</div>
        )}
      </div>

      {/* ── 批量操作栏 ── */}
      {isMultiSelect && (
        <div className="sidebar-batch-bar">
          <button
            className="btn-batch btn-batch-ro"
            onClick={() => batchSetReadonly(true)}
            disabled={batchBusy}
          >
            🔒 设为只读
          </button>
          <button
            className="btn-batch btn-batch-rw"
            onClick={() => batchSetReadonly(false)}
            disabled={batchBusy}
          >
            ✏ 取消只读
          </button>
          <button
            className="btn-batch btn-batch-del"
            onClick={batchDelete}
            disabled={batchBusy}
          >
            🗑 删除（{selectedIds.size}）
          </button>
        </div>
      )}


      {/* 跨日移动日期选择器 */}
      {moveNoteId && (
        <div className="move-date-overlay" onClick={() => setMoveNoteId(null)}>
          <div className="move-date-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="move-date-title">移至日期</div>
            <input
              ref={moveInputRef}
              type="date"
              className="move-date-input"
              onChange={handleMoveDateChange}
              autoFocus
            />
            <button className="btn-cancel" onClick={() => setMoveNoteId(null)}>
              取消
            </button>
          </div>
        </div>
      )}

      {/* 模板选择器 */}
      {templateOpen && (
        <TemplatePicker
          filterNoPath
          onSelect={(t) => {
            onCreateWithTemplate(t);
            setTemplateOpen(false);
          }}
          onBlank={() => {
            onCreate();
            setTemplateOpen(false);
          }}
          onClose={() => setTemplateOpen(false)}
          anchorRect={newBtnRef.current?.getBoundingClientRect() ?? null}
        />
      )}
    </div>
  );
}
