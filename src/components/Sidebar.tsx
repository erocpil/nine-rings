import { useRef, useState, useEffect, useLayoutEffect } from "react";
import type { Note as FullNote } from "../types/models";
type Note = Omit<FullNote, "content">;
import { TagFilter } from "./TagFilter";
import { api } from "../lib/api";
import { TemplatePicker } from "./TemplatePicker";
import type { Template } from "../lib/storage/template-store";
import { MobileActionSheet } from "./MobileActionSheet";
import { useTransientMessage } from "../hooks/useTransientMessage";

type SortMode = "manual" | "created" | "updated" | "title";
const SORT_MODE_KEY = "nr:sortMode";
const SHOW_ALL_KEY = "nr:sidebarShowAll";
const SIDEBAR_SCROLL_TODAY_KEY = "nr:sidebarScrollToday";
const SIDEBAR_SCROLL_ALL_KEY = "nr:sidebarScrollAll";

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
  onSelect: (note: FullNote) => void;
  onCreate: () => void;
  onCreateWithTemplate: (template: Template) => void;
  onDelete: (id: string) => Promise<void>;
  onBatchDelete: (ids: string[]) => Promise<void>;
  onBatchSetReadonly: (ids: string[], readonly: boolean) => Promise<void>;
  onReorder: (orderedIds: string[]) => Promise<void>;
  onMoveToDate: (id: string, date: string) => Promise<void>;
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
  onDelete, onBatchDelete, onBatchSetReadonly, onReorder, onMoveToDate,
  onTagSelect, onTogglePin, onRename, onToggleReadonly, sidebarRefreshKey, disabled,
}: SidebarProps) {
  const [moveNoteId, setMoveNoteId] = useState<string | null>(null);
  const [moveDate, setMoveDate] = useState("");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [reorderBusy, setReorderBusy] = useState(false);
  const { message, showMessage } = useTransientMessage();
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const dragOverIdxRef = useRef<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [actionNoteId, setActionNoteId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoredScrollModeRef = useRef<string | null>(null);

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
  const [showAll, setShowAll] = useState(() => localStorage.getItem(SHOW_ALL_KEY) === "true");
  const [allNotes, setAllNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (!showAll) return;
    let cancelled = false;
    api.notes.all()
      .then((nextNotes) => { if (!cancelled) setAllNotes(nextNotes); })
      .catch(() => { if (!cancelled) setAllNotes([]); });
    return () => { cancelled = true; };
  }, [showAll, sidebarRefreshKey]);

  // 当日列表由全局 store 乐观更新；“全部”模式的独立缓存也同步替换
  // 已加载项目，避免标题、置顶和只读状态要等下一次完整查询才变化。
  useEffect(() => {
    if (!showAll || notes.length === 0) return;
    const currentById = new Map(notes.map((note) => [note.id, note]));
    setAllNotes((current) => current.map((note) => currentById.get(note.id) ?? note));
  }, [notes, showAll]);

  const sourceNotes = showAll ? allNotes : notes;
  const displayNotes = activeTag ? sourceNotes.filter((note) => note.tags.includes(activeTag)) : sourceNotes;
  const sortedNotes = applySort(displayNotes, sortMode);

  useEffect(() => {
    localStorage.setItem(SHOW_ALL_KEY, String(showAll));
  }, [showAll]);

  useLayoutEffect(() => {
    const mode = showAll ? "all" : "today";
    if (!listRef.current || restoredScrollModeRef.current === mode) return;
    // “全部”列表异步加载完成后再恢复，避免空容器把位置夹回 0。
    if (showAll && sortedNotes.length === 0) return;
    const key = showAll ? SIDEBAR_SCROLL_ALL_KEY : SIDEBAR_SCROLL_TODAY_KEY;
    const saved = Number(localStorage.getItem(key));
    if (Number.isFinite(saved) && saved >= 0) listRef.current.scrollTop = saved;
    restoredScrollModeRef.current = mode;
  }, [showAll, sortedNotes.length]);

  // ── 点击处理：Shift 多选 ──
  const openRequestRef = useRef(0);
  useEffect(() => () => { openRequestRef.current++; }, []);
  const openNote = (note: Note) => {
    const request = ++openRequestRef.current;
    if ("content" in note) { onSelect(note as FullNote); return; }
    void api.notes.get(note.id).then((full) => {
      if (full && openRequestRef.current === request) onSelect(full);
    }).catch((error) => console.error("读取搜索结果失败", error));
  };
  const handleItemClick = (e: React.MouseEvent, note: Note, index: number) => {
    // Row navigation runs on mousedown, before child buttons receive click.
    // A row action must not first select its note (and dismiss the mobile drawer).
    if (e.target instanceof Element && e.target.closest("button, input, select, textarea, a")) return;
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
        openNote(note);
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
    openNote(note);
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
      await onBatchDelete(ids);
      clearSelection();
    } catch { /* noop */ }
    setBatchBusy(false);
  };

  const batchSetReadonly = async (ro: boolean) => {
    if (disabled || batchBusy) return;
    setBatchBusy(true);
    try {
      await onBatchSetReadonly([...selectedIds], ro);
      clearSelection();
      showMessage(ro ? "已设为只读" : "已设为可编辑");
    } catch (error) {
      showMessage(`批量设置失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setBatchBusy(false);
    }
  };

  // ── Delete (immediate) ──

  const deleteNote = async (id: string) => {
    if (disabled) return;
    await onDelete(id);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    void deleteNote(id);
  };

  // ── Drag & Drop reorder ──

  const canReorder = sortMode === "manual" && !activeTag && !isMultiSelect && !disabled && !reorderBusy;

  const saveOrder = async (ids: string[]) => {
    if (!canReorder) return;
    setReorderBusy(true);
    try {
      await onReorder(ids);
      const orderById = new Map(ids.map((id, index) => [id, index]));
      setAllNotes((current) => current.map((note) => orderById.has(note.id)
        ? { ...note, sort_order: orderById.get(note.id)! }
        : note));
      showMessage("顺序已保存");
    } catch (error) {
      showMessage(`调整顺序失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setReorderBusy(false);
    }
  };

  const handleDragStart = (event: React.DragEvent, id: string, index: number) => {
    if (!canReorder) {
      event.preventDefault();
      return;
    }
    // Firefox and some WebViews require drag data before they start a native
    // drag. Keeping it on the handle also prevents selecting/opening the note.
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    _dragId = id;
    _dragIndex = index;
  };

  const handleDragEnter = (index: number) => {
    if (_dragId === null) return;
    dragOverIdxRef.current = index;
    setDragOverIdx(index);
  };

  const handleDragEnd = () => {
    setDragOverIdx(null);
    const targetIdx = dragOverIdxRef.current;
    dragOverIdxRef.current = null;
    if (_dragId === null || _dragIndex === -1) return;
    if (targetIdx === null || targetIdx === _dragIndex) {
      _dragId = null;
      _dragIndex = -1;
      return;
    }
    const arr = sortedNotes.map((n) => n.id);
    const [moved] = arr.splice(_dragIndex, 1);
    arr.splice(targetIdx, 0, moved);
    void saveOrder(arr);
    _dragId = null;
    _dragIndex = -1;
  };

  const reorderByOffset = (id: string, offset: -1 | 1) => {
    if (!canReorder) return;
    const fromIndex = sortedNotes.findIndex((note) => note.id === id);
    const toIndex = fromIndex + offset;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= sortedNotes.length) return;
    // 置顶与普通随笔是两个稳定分组，不能通过顺序值跨越分组边界。
    if (sortedNotes[fromIndex].pinned !== sortedNotes[toIndex].pinned) return;
    const reordered = [...sortedNotes];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    void saveOrder(reordered.map((note) => note.id));
  };

  // ── Cross-day move ──

  const openMoveDate = (id: string) => {
    if (disabled) return;
    setMoveDate(sortedNotes.find((note) => note.id === id)?.date ?? "");
    setMoveError(null);
    setMoveNoteId(id);
  };

  const handleMoveClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    openMoveDate(id);
  };

  const submitMoveDate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!moveNoteId || !moveDate || moveBusy || disabled) return;
    setMoveBusy(true);
    setMoveError(null);
    try {
      await onMoveToDate(moveNoteId, moveDate);
      setMoveNoteId(null);
      showMessage(`已移至 ${moveDate}；全部随笔中仍会保留显示`);
    } catch (error) {
      setMoveError(`移动失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMoveBusy(false);
    }
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
  const actionNote = actionNoteId ? sortedNotes.find((note) => note.id === actionNoteId) ?? null : null;
  const actionNoteIndex = actionNote
    ? sortedNotes.findIndex((note) => note.id === actionNote.id)
    : -1;
  const canMoveActionNoteUp = Boolean(
    canReorder
    && actionNote
    && actionNoteIndex > 0
    && sortedNotes[actionNoteIndex - 1]?.pinned === actionNote.pinned,
  );
  const canMoveActionNoteDown = Boolean(
    canReorder
    && actionNote
    && actionNoteIndex >= 0
    && actionNoteIndex < sortedNotes.length - 1
    && sortedNotes[actionNoteIndex + 1]?.pinned === actionNote.pinned,
  );

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
      <TagFilter activeTag={activeTag} onTagSelect={onTagSelect} refreshKey={sidebarRefreshKey} />
      {message && <div className="sidebar-action-message" role="status">{message}</div>}
      {isMultiSelect && (
        <div className="sidebar-multi-info">
          已选 {selectedIds.size} 篇
          <button className="sidebar-multi-clear" onClick={clearSelection}>取消</button>
        </div>
      )}
      <div
        className="sidebar-list"
        ref={listRef}
        onScroll={(event) => {
          const key = showAll ? SIDEBAR_SCROLL_ALL_KEY : SIDEBAR_SCROLL_TODAY_KEY;
          localStorage.setItem(key, String(event.currentTarget.scrollTop));
        }}
      >
        {sortedNotes.map((note, i) => (
          <div
            key={note.id}
            className={`sidebar-item ${note.id === selectedId ? "active" : ""} ${isInSelected(note.id) ? "selected" : ""} ${note.readonly ? "sidebar-item-ro" : ""} ${dragOverIdx === i ? "drag-over" : ""}`}
            onMouseDown={(e) => handleItemClick(e, note, i)}
            onDragEnter={() => handleDragEnter(i)}
            onDragOver={(e) => {
              if (_dragId === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
          >
            <div
              className="sidebar-item-drag"
              draggable={canReorder}
              aria-label="拖动排序"
              title={canReorder ? "拖动排序" : sortMode !== "manual" ? "仅手动排序模式可拖动" : undefined}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onDragStart={(event) => handleDragStart(event, note.id, i)}
              onDragEnd={handleDragEnd}
            >⠿</div>
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
                {showAll && `${note.date} · `}
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
              <button
                type="button"
                className="sidebar-item-more"
                aria-label={`更多随笔操作 ${note.title || "无标题"}`}
                title="更多操作"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setActionNoteId(note.id);
                }}
              >⋯</button>
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
        {sortedNotes.length === 0 && (
          <div className="sidebar-empty">{activeTag ? "没有符合标签的随笔" : showAll ? "还没有随笔" : "今天还没有笔记"}</div>
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

      <MobileActionSheet
        open={Boolean(actionNote)}
        title={actionNote ? `随笔：${actionNote.title || "无标题"}` : "随笔操作"}
        onClose={() => setActionNoteId(null)}
        className="sidebar-action-sheet"
      >
        {actionNote && (
          <>
            <button
              type="button"
              className="menu-dropdown-item"
              disabled={disabled}
              onClick={() => {
                setActionNoteId(null);
                startRename(actionNote);
              }}
            >✎ 重命名</button>
            <button
              type="button"
              className="menu-dropdown-item"
              disabled={disabled}
              onClick={() => {
                setActionNoteId(null);
                onTogglePin(actionNote.id, !actionNote.pinned);
              }}
            >{actionNote.pinned ? "📌 取消置顶" : "📍 置顶"}</button>
            <button
              type="button"
              className="menu-dropdown-item"
              disabled={disabled}
              onClick={() => {
                setActionNoteId(null);
                onToggleReadonly(actionNote.id, !actionNote.readonly);
              }}
            >{actionNote.readonly ? "🔓 取消只读" : "🔒 设为只读"}</button>
            <button
              type="button"
              className="menu-dropdown-item"
              disabled={disabled}
              onClick={() => {
                setActionNoteId(null);
                openMoveDate(actionNote.id);
              }}
            >📅 移至其他日期</button>
            <button
              type="button"
              className="menu-dropdown-item"
              disabled={!canMoveActionNoteUp}
              onClick={() => {
                setActionNoteId(null);
                reorderByOffset(actionNote.id, -1);
              }}
            >↑ 向上移动</button>
            <button
              type="button"
              className="menu-dropdown-item"
              disabled={!canMoveActionNoteDown}
              onClick={() => {
                setActionNoteId(null);
                reorderByOffset(actionNote.id, 1);
              }}
            >↓ 向下移动</button>
            {(!canMoveActionNoteUp || !canMoveActionNoteDown) && (
              <p className="sidebar-action-hint">
                {sortMode !== "manual" ? "切换到手动排序后可调整顺序。"
                  : activeTag ? "清除标签筛选后可调整顺序。"
                  : reorderBusy ? "正在保存顺序…"
                  : disabled ? "当前操作已暂时锁定。"
                  : "已到列表或置顶分组边界，无法继续向该方向移动。"}
              </p>
            )}
            <button
              type="button"
              className="menu-dropdown-item menu-dropdown-danger"
              disabled={disabled}
              onClick={() => {
                setActionNoteId(null);
                void deleteNote(actionNote.id);
              }}
            >🗑 删除</button>
          </>
        )}
      </MobileActionSheet>

      {/* 跨日移动日期选择器通过 portal 脱离侧栏 overflow，避免触控端被裁切。 */}
      <MobileActionSheet
        open={Boolean(moveNoteId)}
        title="移至日期"
        onClose={() => { if (!moveBusy) setMoveNoteId(null); }}
        className="move-date-sheet"
      >
        {moveNoteId && (
          <form className="move-date-content" onSubmit={(event) => void submitMoveDate(event)}>
            <label className="move-date-field">
              <span>目标日期</span>
              <input
                type="date"
                className="move-date-input"
                aria-label="目标日期"
                value={moveDate}
                onChange={(event) => setMoveDate(event.target.value)}
                required
                disabled={moveBusy || disabled}
              />
            </label>
            {moveError && <p className="move-date-error" role="alert">{moveError}</p>}
            <button type="button" className="btn btn-secondary" disabled={moveBusy} onClick={() => setMoveNoteId(null)}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={!moveDate || moveBusy || disabled}>
              {moveBusy ? "移动中…" : "移动"}
            </button>
          </form>
        )}
      </MobileActionSheet>

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
