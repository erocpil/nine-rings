import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Todo } from "../types/models";
import { uuid } from "../lib/uuid";
import { api } from "../lib/api";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ── 常量 ──

const MAX_DEPTH = 3;
const INDENT_PX = 24;

// ── 提醒调度 ──

const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleReminder(todo: Todo, onFired: () => void) {
  if (!todo.remind_at || todo.done) return;
  const target = new Date(todo.remind_at).getTime();
  const now = Date.now();
  if (target <= now) return;

  if (activeTimers.has(todo.id)) {
    clearTimeout(activeTimers.get(todo.id)!);
  }

  const timer = setTimeout(() => {
    activeTimers.delete(todo.id);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("⏰ 待办提醒", {
        body: todo.text,
        icon: "/favicon.ico",
        tag: todo.id,
      });
    }
    onFired();
  }, target - now);

  activeTimers.set(todo.id, timer);
}

function clearReminder(todoId: string) {
  const timer = activeTimers.get(todoId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(todoId);
  }
}

// ── 树结构 ──

/** 获取某个 parent_id 下的所有子节点（按 order 排序） */
function getChildren(todos: Todo[], parentId: string | null): Todo[] {
  return todos
    .filter((t) => (t.parent_id ?? null) === parentId)
    .sort((a, b) => a.order - b.order);
}

/** 计算某个 todo 的深度（从 root 往上数） */
function getDepth(todos: Todo[], id: string): number {
  let depth = 0;
  let current = todos.find((t) => t.id === id);
  while (current?.parent_id) {
    depth++;
    current = todos.find((t) => t.id === current!.parent_id);
  }
  return depth;
}

/** 获取某个 todo 的所有后代 ID */
function getDescendantIds(todos: Todo[], id: string): Set<string> {
  const ids = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    for (const t of todos) {
      if ((t.parent_id ?? null) === pid) {
        ids.add(t.id);
        stack.push(t.id);
      }
    }
  }
  return ids;
}

// ── 类型 ──

interface OverdueItem {
  todo: Todo;
  date: string;
}

interface TodoListProps {
  todos: Todo[];
  onChange: (todos: Todo[]) => void;
  disabled?: boolean;
}

// ── 可拖拽待办条目 ──

function SortableTodoItem({
  todo,
  depth,
  dragOverId,
  editingId,
  editText,
  remindTodoId,
  remindTime,
  onToggle,
  onRemove,
  onStartEdit,
  onEditChange,
  onEditSave,
  onEditCancel,
  onRemindClick,
  onRemindTimeChange,
  onRemindSet,
  onRemindClear,
  onIndent,
  onOutdent,
  canIndent,
  canOutdent,
}: {
  todo: Todo;
  depth: number;
  dragOverId: string | null;
  editingId: string | null;
  editText: string;
  remindTodoId: string | null;
  remindTime: string;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onStartEdit: (todo: Todo) => void;
  onEditChange: (text: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onRemindClick: (todoId: string) => void;
  onRemindTimeChange: (time: string) => void;
  onRemindSet: (todoId: string, time: string) => void;
  onRemindClear: (todoId: string) => void;
  onIndent: () => void;
  onOutdent: () => void;
  canIndent: boolean;
  canOutdent: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id, disabled: editingId === todo.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, paddingLeft: depth * INDENT_PX }}
      className={`todo-item ${dragOverId === todo.id ? "todo-drop-target" : ""} ${
        isDragging ? "todo-dragging" : ""
      }`}
    >
      <span className="todo-drag-handle" title="拖拽排序" {...attributes} {...listeners}>
        ⋮⋮
      </span>
      <span className="todo-indent-btns">
        {canIndent && (
          <button
            className="todo-indent-btn"
            title="缩进 (Tab) — 作为上一条的子任务"
            onClick={(e) => { e.stopPropagation(); onIndent(); }}
            tabIndex={-1}
          >
            →
          </button>
        )}
        {canOutdent && (
          <button
            className="todo-indent-btn todo-outdent-btn"
            title="减少缩进 (Shift+Tab)"
            onClick={(e) => { e.stopPropagation(); onOutdent(); }}
            tabIndex={-1}
          >
            ←
          </button>
        )}
      </span>
      <input
        type="checkbox"
        className="todo-checkbox"
        checked={todo.done}
        onChange={() => onToggle(todo.id)}
      />
      {editingId === todo.id ? (
        <input
          className="todo-edit-input"
          value={editText}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEditSave();
            if (e.key === "Escape") onEditCancel();
            if (e.key === "Tab") {
              e.preventDefault();
              if (e.shiftKey) onOutdent();
              else onIndent();
            }
          }}
          onBlur={onEditSave}
          autoFocus
        />
      ) : (
        <span
          className={`todo-text ${todo.done ? "done" : ""}`}
          onDoubleClick={() => onStartEdit(todo)}
          title="双击编辑"
        >
          {todo.text}
        </span>
      )}
      <button
        className={`todo-remind-btn ${todo.remind_at ? "active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemindClick(todo.id);
        }}
        title={
          todo.remind_at
            ? `已设提醒: ${new Date(todo.remind_at).toLocaleString()}`
            : "设置提醒"
        }
      >
        {todo.remind_at ? "🔔" : "🔕"}
      </button>
      <button
        className="todo-remove"
        onClick={() => onRemove(todo.id)}
        title="删除"
      >
        ×
      </button>

      {remindTodoId === todo.id && (
        <div
          className="todo-remind-picker"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="datetime-local"
            className="todo-remind-input"
            value={remindTime}
            onChange={(e) => onRemindTimeChange(e.target.value)}
          />
          <button
            className="todo-remind-set"
            onClick={() => onRemindSet(todo.id, new Date(remindTime).toISOString())}
          >
            设置
          </button>
          {todo.remind_at && (
            <button
              className="todo-remind-clear"
              onClick={() => onRemindClear(todo.id)}
            >
              清除
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── 递归渲染一层 ──

function TodoLevel({
  items,
  allTodos,
  depth,
  dragOverId,
  editingId,
  editText,
  remindTodoId,
  remindTime,
  onToggle,
  onRemove,
  onStartEdit,
  onEditChange,
  onEditSave,
  onEditCancel,
  onRemindClick,
  onRemindTimeChange,
  onRemindSet,
  onRemindClear,
  onIndent,
  onOutdent,
}: {
  items: Todo[];
  allTodos: Todo[];
  depth: number;
  dragOverId: string | null;
  editingId: string | null;
  editText: string;
  remindTodoId: string | null;
  remindTime: string;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onStartEdit: (todo: Todo) => void;
  onEditChange: (text: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onRemindClick: (todoId: string) => void;
  onRemindTimeChange: (time: string) => void;
  onRemindSet: (todoId: string, time: string) => void;
  onRemindClear: (todoId: string) => void;
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
}) {
  return (
    <SortableContext items={items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
      {items.map((todo) => {
        const children = getChildren(allTodos, todo.id);
        const d = getDepth(allTodos, todo.id);
        // canIndent: can indent under the previous sibling at same level
        const idx = items.findIndex((t) => t.id === todo.id);
        const prevSibling = idx > 0 ? items[idx - 1] : null;
        const canIndent = d < MAX_DEPTH && !!prevSibling && !todo.done;
        const canOutdent = d > 0;

        return (
          <div key={todo.id}>
            <SortableTodoItem
              todo={todo}
              depth={d}
              dragOverId={dragOverId}
              editingId={editingId}
              editText={editText}
              remindTodoId={remindTodoId}
              remindTime={remindTime}
              onToggle={onToggle}
              onRemove={onRemove}
              onStartEdit={onStartEdit}
              onEditChange={onEditChange}
              onEditSave={onEditSave}
              onEditCancel={onEditCancel}
              onRemindClick={onRemindClick}
              onRemindTimeChange={onRemindTimeChange}
              onRemindSet={onRemindSet}
              onRemindClear={onRemindClear}
              onIndent={() => onIndent(todo.id)}
              onOutdent={() => onOutdent(todo.id)}
              canIndent={canIndent}
              canOutdent={canOutdent}
            />
            {children.length > 0 && (
              <TodoLevel
                items={children}
                allTodos={allTodos}
                depth={depth + 1}
                dragOverId={dragOverId}
                editingId={editingId}
                editText={editText}
                remindTodoId={remindTodoId}
                remindTime={remindTime}
                onToggle={onToggle}
                onRemove={onRemove}
                onStartEdit={onStartEdit}
                onEditChange={onEditChange}
                onEditSave={onEditSave}
                onEditCancel={onEditCancel}
                onRemindClick={onRemindClick}
                onRemindTimeChange={onRemindTimeChange}
                onRemindSet={onRemindSet}
                onRemindClear={onRemindClear}
                onIndent={onIndent}
                onOutdent={onOutdent}
              />
            )}
          </div>
        );
      })}
    </SortableContext>
  );
}

// ── 主组件 ──

export function TodoList({ todos, onChange, disabled }: TodoListProps) {
  const [undoTodo, setUndoTodo] = useState<{
    todo: Todo;
    previousTodos: Todo[];
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [overdueItems, setOverdueItems] = useState<OverdueItem[]>([]);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [refreshOverdue, setRefreshOverdue] = useState(0);

  const [remindTodoId, setRemindTodoId] = useState<string | null>(null);
  const [remindTime, setRemindTime] = useState("");
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>("default");

  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // 顶层待办
  const topLevelTodos = useMemo(
    () => getChildren(todos, null),
    [todos]
  );

  // 通知权限
  useEffect(() => {
    if ("Notification" in window) setNotifPerm(Notification.permission);
  }, []);

  // 提醒调度
  useEffect(() => {
    activeTimers.forEach((timer) => clearTimeout(timer));
    activeTimers.clear();
    for (const t of todos) {
      if (t.remind_at && !t.done) scheduleReminder(t, () => {});
    }
    return () => {
      activeTimers.forEach((timer) => clearTimeout(timer));
      activeTimers.clear();
    };
  }, [todos]);

  const requestNotifPermission = async () => {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
  };

  const setReminder = (todoId: string, isoTime: string) => {
    if (disabled) return;
    if (!isoTime) {
      clearReminder(todoId);
      onChange(todos.map((t) => (t.id === todoId ? { ...t, remind_at: undefined } : t)));
      return;
    }
    onChange(todos.map((t) => (t.id === todoId ? { ...t, remind_at: isoTime } : t)));
  };

  const openRemindPicker = (todoId: string) => {
    if (notifPerm !== "granted") {
      requestNotifPermission().then(() => {
        setRemindTodoId(todoId);
        setRemindTime(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
      });
      return;
    }
    setRemindTodoId(todoId);
    const existing = todos.find((t) => t.id === todoId);
    setRemindTime(
      existing?.remind_at
        ? existing.remind_at.slice(0, 16)
        : new Date(Date.now() + 3600000).toISOString().slice(0, 16)
    );
  };

  const handleRemindSet = (todoId: string, time: string) => {
    setReminder(todoId, time);
    setRemindTodoId(null);
  };

  const handleRemindClear = (todoId: string) => {
    setReminder(todoId, "");
    setRemindTodoId(null);
  };

  // ── 导出 ──
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"text" | "md">("text");

  // 过期待办
  useEffect(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    api.daily.getAll().then((pages) => {
      const items: OverdueItem[] = [];
      for (const p of pages) {
        if (p.date >= todayStr) continue;
        if (!Array.isArray(p.todos)) continue;
        for (const t of p.todos) {
          if (!t.done) items.push({ todo: t, date: p.date });
        }
      }
      items.sort((a, b) => b.date.localeCompare(a.date));
      setOverdueItems(items);
    }).catch(() => {});
  }, [refreshOverdue]);

  useEffect(() => {
    if (!undoTodo) return;
    const timer = setTimeout(() => setUndoTodo(null), 5000);
    return () => clearTimeout(timer);
  }, [undoTodo]);

  // ── 突变操作 ──

  const toggleTodo = (id: string) => {
    if (disabled) return;
    onChange(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const removeTodo = (id: string) => {
    if (disabled) return;
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;
    setUndoTodo({ todo, previousTodos: todos });
    // Remove the item AND all descendants
    const descIds = getDescendantIds(todos, id);
    descIds.add(id);
    onChange(todos.filter((t) => !descIds.has(t.id)));
  };

  const undoRemove = () => {
    if (disabled || !undoTodo) return;
    onChange(undoTodo.previousTodos);
    setUndoTodo(null);
  };

  const addTodo = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    if (disabled) return;
    const input = e.currentTarget;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    const maxOrder = Math.max(0, ...topLevelTodos.map((t) => t.order));
    onChange([
      ...todos,
      { id: uuid(), text, done: false, order: maxOrder + 1, tags: [], parent_id: null },
    ]);
  };

  const startEdit = (todo: Todo) => {
    if (disabled || todo.done) return;
    setEditingId(todo.id);
    setEditText(todo.text);
  };

  const saveEdit = () => {
    if (!editingId || disabled) return;
    const text = editText.trim();
    if (text) {
      onChange(todos.map((t) => (t.id === editingId ? { ...t, text } : t)));
    }
    setEditingId(null);
    setEditText("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  // ── 缩进 / 减少缩进 ──

  const handleIndent = (id: string) => {
    if (disabled) return;
    const depth = getDepth(todos, id);
    if (depth >= MAX_DEPTH) return;
    const todo = todos.find((t) => t.id === id);
    if (!todo || todo.done) return;

    // Find previous sibling at same level
    const siblings = getChildren(todos, todo.parent_id ?? null);
    const idx = siblings.findIndex((t) => t.id === id);
    if (idx <= 0) return; // no previous sibling to indent under
    const newParent = siblings[idx - 1];

    // Move this item (and all its descendants) under newParent
    const newChildren = getChildren(todos, newParent.id);
    const maxOrder = Math.max(0, ...newChildren.map((t) => t.order));

    onChange(
      todos.map((t) => {
        if (t.id === id) {
          return { ...t, parent_id: newParent.id, order: maxOrder + 1 };
        }
        return t;
      })
    );
  };

  const handleOutdent = (id: string) => {
    if (disabled) return;
    const todo = todos.find((t) => t.id === id);
    if (!todo || !todo.parent_id) return;
    const parent = todos.find((t) => t.id === todo.parent_id);
    if (!parent) return;
    const newParentId = parent.parent_id ?? null;

    // Move after the parent at the new level
    const newSiblings = getChildren(todos, newParentId);
    const parentIdx = newSiblings.findIndex((t) => t.id === parent.id);
    const insertOrder =
      parentIdx >= 0 && parentIdx + 1 < newSiblings.length
        ? newSiblings[parentIdx + 1].order
        : (newSiblings[parentIdx]?.order ?? 0) + 1;

    onChange(
      todos.map((t) => {
        if (t.id === id) {
          return { ...t, parent_id: newParentId, order: insertOrder };
        }
        return t;
      })
    );
  };

  // ── @dnd-kit 拖拽 ──

  const handleDragOver = (event: DragOverEvent) => {
    setDragOverId(event.over?.id as string ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragOverId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = todos.find((t) => t.id === active.id);
    const to = todos.find((t) => t.id === over.id);
    if (!from || !to) return;

    // Only allow reorder within same parent level
    if ((from.parent_id ?? null) !== (to.parent_id ?? null)) return;

    const siblings = getChildren(todos, from.parent_id ?? null);
    const oldIdx = siblings.findIndex((t) => t.id === from.id);
    const newIdx = siblings.findIndex((t) => t.id === to.id);
    if (oldIdx === -1 || newIdx === -1) return;

    const reordered = arrayMove(siblings, oldIdx, newIdx).map((t, i) => ({
      ...t,
      order: i,
    }));

    // Rebuild: replace siblings with reordered version
    const result = todos.map((t) => {
      const found = reordered.find((r) => r.id === t.id);
      return found ?? t;
    });

    onChange(result);
  };

  // ── 导出 ──

  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generateExport = useCallback((): string => {
    const walk = (items: Todo[], prefix: string): string[] => {
      return items.flatMap((t) => {
        const marker = t.done ? "☑" : "☐";
        const lines = [`${prefix}${marker} ${t.text}`];
        const children = getChildren(todos, t.id);
        if (children.length > 0) {
          lines.push(...walk(children, prefix + "  "));
        }
        return lines;
      });
    };

    const active = topLevelTodos.filter((t) => !t.done);
    const done = topLevelTodos.filter((t) => t.done);

    if (exportFormat === "md") {
      const lines: string[] = ["## 今日待办\n"];
      if (active.length === 0) {
        lines.push("（无）\n");
      } else {
        for (const t of active) {
          lines.push(`- [ ] ${t.text}`);
          for (const c of getChildren(todos, t.id)) {
            lines.push(`  - [ ] ${c.text}`);
          }
        }
      }
      if (done.length > 0) {
        lines.push(`\n## 已完成 (${done.length})\n`);
        for (const t of done) {
          lines.push(`- [x] ${t.text}`);
        }
      }
      return lines.join("\n");
    }

    const lines: string[] = ["今日待办", "────────"];
    if (active.length === 0) {
      lines.push("（无）");
    } else {
      lines.push(...walk(active, ""));
    }
    if (done.length > 0) {
      lines.push("", `已完成 (${done.length})`, "────────");
      lines.push(...done.map((t) => `☑ ${t.text}`));
    }
    return lines.join("\n");
  }, [todos, topLevelTodos, exportFormat]);

  const handleExportClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      navigator.clipboard.writeText(generateExport()).catch(() => {});
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      setExportOpen((v) => !v);
    }, 300);
  }, [generateExport]);

  const handleOverdueToggle = (item: OverdueItem) => {
    api.daily.get(item.date).then((page) => {
      const updated = page.todos.map((t) =>
        t.id === item.todo.id ? { ...t, done: !t.done } : t
      );
      return api.daily.updateTodos({ date: item.date, todos: updated });
    }).then(() => setRefreshOverdue((n) => n + 1)).catch(() => {});
  };

  const formatDate = (dateStr: string) => {
    const parts = dateStr.split("-");
    return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
  };

  return (
    <div className="todo-list">
      <h3 className="section-title">
        <span>{exportOpen ? "导出待办" : `今日待办 (${todos.length})`}</span>
        <span className="section-title-spacer" />
        {exportOpen && (
          <span className="todo-export-format">
            <button
              className={`todo-export-fmt-btn ${exportFormat === "text" ? "active" : ""}`}
              onClick={() => setExportFormat("text")}
            >
              纯文本
            </button>
            <button
              className={`todo-export-fmt-btn ${exportFormat === "md" ? "active" : ""}`}
              onClick={() => setExportFormat("md")}
            >
              Markdown
            </button>
          </span>
        )}
        <button
          className={`btn-icon todo-export-btn ${exportOpen ? "active" : ""}`}
          onClick={handleExportClick}
          title={exportOpen ? "取消导出" : "单击导出 / 双击复制"}
        >
          ⬆
        </button>
        {overdueItems.length > 0 && (
          <button
            className={`overdue-badge ${overdueOpen ? "open" : ""}`}
            onClick={() => setOverdueOpen((v) => !v)}
            title="点击展开/收起过期待办"
          >
            过期待办 ({overdueItems.length})
          </button>
        )}
      </h3>

      {!exportOpen && overdueOpen && overdueItems.length > 0 && (
        <div className="overdue-section">
          <div className="overdue-items">
            {overdueItems.map((item) => (
              <div key={item.todo.id} className="todo-item overdue-item">
                <input
                  type="checkbox"
                  className="todo-checkbox"
                  checked={item.todo.done}
                  onChange={() => handleOverdueToggle(item)}
                />
                <span className="todo-text overdue-text">{item.todo.text}</span>
                <span className="overdue-date">{formatDate(item.date)}</span>
                <button
                  className="todo-remove"
                  onClick={() => {
                    api.daily.get(item.date).then((page) => {
                      const updated = page.todos.filter((t) => t.id !== item.todo.id);
                      return api.daily.updateTodos({ date: item.date, todos: updated });
                    }).then(() => setRefreshOverdue((n) => n + 1)).catch(() => {});
                  }}
                  title="删除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {exportOpen && (
        <div className="todo-export-panel">
          <textarea
            className="todo-export-textarea"
            value={generateExport()}
            readOnly
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
        </div>
      )}

      {!exportOpen && (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            {topLevelTodos.length > 0 ? (
              <TodoLevel
                items={topLevelTodos}
                allTodos={todos}
                depth={0}
                dragOverId={dragOverId}
                editingId={editingId}
                editText={editText}
                remindTodoId={remindTodoId}
                remindTime={remindTime}
                onToggle={toggleTodo}
                onRemove={removeTodo}
                onStartEdit={startEdit}
                onEditChange={setEditText}
                onEditSave={saveEdit}
                onEditCancel={cancelEdit}
                onRemindClick={openRemindPicker}
                onRemindTimeChange={setRemindTime}
                onRemindSet={handleRemindSet}
                onRemindClear={handleRemindClear}
                onIndent={handleIndent}
                onOutdent={handleOutdent}
              />
            ) : (
              <div className="todo-items" />
            )}
          </DndContext>

          <input
            type="text"
            placeholder="添加待办..."
            onKeyDown={addTodo}
            className="todo-input"
          />
        </>
      )}

      {undoTodo && (
        <div className="todo-undo-bar">
          <span>已删除「{undoTodo.todo.text}」</span>
          <button className="todo-undo-btn" onClick={undoRemove}>
            撤销
          </button>
        </div>
      )}
    </div>
  );
}
