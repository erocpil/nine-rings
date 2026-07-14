import { useCallback, useEffect, useRef, useState } from "react";
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
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
  index,
  dragOverIdx,
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
}: {
  todo: Todo;
  index: number;
  dragOverIdx: number | null;
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
      style={style}
      className={`todo-item ${dragOverIdx === index ? "todo-drop-target" : ""} ${
        isDragging ? "todo-dragging" : ""
      }`}
    >
      <span className="todo-drag-handle" title="拖拽排序" {...attributes} {...listeners}>
        ⋮⋮
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

      {/* 提醒时间选择器 */}
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
            onClick={() => {
              onRemindSet(todo.id, new Date(remindTime).toISOString());
            }}
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

  // ── 提醒状态 ──
  const [remindTodoId, setRemindTodoId] = useState<string | null>(null);
  const [remindTime, setRemindTime] = useState("");
  const [notifPerm, setNotifPerm] =
    useState<NotificationPermission>("default");

  // ── 拖拽状态 ──
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // 请求通知权限
  useEffect(() => {
    if ("Notification" in window) {
      setNotifPerm(Notification.permission);
    }
  }, []);

  // 调度所有待办提醒
  useEffect(() => {
    activeTimers.forEach((timer) => clearTimeout(timer));
    activeTimers.clear();

    for (const t of todos) {
      if (t.remind_at && !t.done) {
        scheduleReminder(t, () => {});
      }
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
      onChange(
        todos.map((t) => (t.id === todoId ? { ...t, remind_at: undefined } : t))
      );
      return;
    }
    onChange(
      todos.map((t) => (t.id === todoId ? { ...t, remind_at: isoTime } : t))
    );
  };

  const openRemindPicker = (todoId: string) => {
    if (notifPerm !== "granted") {
      requestNotifPermission().then(() => {
        setRemindTodoId(todoId);
        const d = new Date(Date.now() + 3600000);
        setRemindTime(d.toISOString().slice(0, 16));
      });
      return;
    }
    setRemindTodoId(todoId);
    const existing = todos.find((t) => t.id === todoId);
    if (existing?.remind_at) {
      setRemindTime(existing.remind_at.slice(0, 16));
    } else {
      const d = new Date(Date.now() + 3600000);
      setRemindTime(d.toISOString().slice(0, 16));
    }
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

  // ── 拉取过期待办 ──
  useEffect(() => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    api.daily
      .getAll()
      .then((pages) => {
        const items: OverdueItem[] = [];
        for (const p of pages) {
          if (p.date >= todayStr) continue;
          if (!Array.isArray(p.todos)) continue;
          for (const t of p.todos) {
            if (!t.done) {
              items.push({ todo: t, date: p.date });
            }
          }
        }
        items.sort((a, b) => b.date.localeCompare(a.date));
        setOverdueItems(items);
      })
      .catch(() => {});
  }, [refreshOverdue]);

  // Auto-dismiss undo after 5s
  useEffect(() => {
    if (!undoTodo) return;
    const timer = setTimeout(() => setUndoTodo(null), 5000);
    return () => clearTimeout(timer);
  }, [undoTodo]);

  const toggleTodo = (id: string) => {
    if (disabled) return;
    onChange(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const removeTodo = (id: string) => {
    if (disabled) return;
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;
    setUndoTodo({ todo, previousTodos: todos });
    onChange(todos.filter((t) => t.id !== id));
  };

  const undoRemove = () => {
    if (disabled) return;
    if (!undoTodo) return;
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
    onChange([
      ...todos,
      { id: uuid(), text, done: false, order: todos.length, tags: [] },
    ]);
  };

  const startEdit = (todo: Todo) => {
    if (disabled || todo.done) return;
    setEditingId(todo.id);
    setEditText(todo.text);
  };

  const saveEdit = () => {
    if (!editingId) return;
    if (disabled) return;
    const text = editText.trim();
    if (text) {
      onChange(
        todos.map((t) => (t.id === editingId ? { ...t, text } : t))
      );
    }
    setEditingId(null);
    setEditText("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  // ── @dnd-kit 拖拽事件 ──

  const handleDragStart = (_event: DragStartEvent) => {
    // drag start marker — needed for visual feedback via isDragging
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragOverIdx(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = todos.findIndex((t) => t.id === active.id);
    const newIndex = todos.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    onChange(arrayMove(todos, oldIndex, newIndex));
  };

  const handleDragOver = (event: DragStartEvent) => {
    const overId = event.active.id as string;
    const idx = todos.findIndex((t) => t.id === overId);
    if (idx !== -1 && idx !== dragOverIdx) {
      setDragOverIdx(idx);
    }
  };

  // ── 导出按钮：双击直接复制 ──
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleExportClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      const text = generateExport();
      navigator.clipboard.writeText(text).catch(() => {});
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      setExportOpen((v) => !v);
    }, 300);
  }, [todos, exportFormat]);

  // ── 导出 todo 列表 ──
  const generateExport = (): string => {
    const active = todos.filter((t) => !t.done);
    const done = todos.filter((t) => t.done);

    if (exportFormat === "md") {
      const lines: string[] = [];
      lines.push("## 今日待办\n");
      if (active.length === 0) {
        lines.push("（无）\n");
      } else {
        for (const t of active) {
          lines.push(`- [ ] ${t.text}`);
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

    const lines: string[] = [];
    lines.push("今日待办");
    lines.push("────────");
    if (active.length === 0) {
      lines.push("（无）");
    } else {
      for (const t of active) {
        lines.push(`☐ ${t.text}`);
      }
    }
    if (done.length > 0) {
      lines.push("");
      lines.push(`已完成 (${done.length})`);
      lines.push("────────");
      for (const t of done) {
        lines.push(`☑ ${t.text}`);
      }
    }
    return lines.join("\n");
  };

  const handleOverdueToggle = (item: OverdueItem) => {
    api.daily
      .get(item.date)
      .then((page) => {
        const updatedTodos = page.todos.map((t) =>
          t.id === item.todo.id ? { ...t, done: !t.done } : t
        );
        return api.daily.updateTodos({
          date: item.date,
          todos: updatedTodos,
        });
      })
      .then(() => {
        setRefreshOverdue((n) => n + 1);
      })
      .catch(() => {});
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

      {/* 过期待办区域 */}
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
                <span className="todo-text overdue-text">
                  {item.todo.text}
                </span>
                <span className="overdue-date">{formatDate(item.date)}</span>
                <button
                  className="todo-remove"
                  onClick={() => {
                    api.daily
                      .get(item.date)
                      .then((page) => {
                        const updatedTodos = page.todos.filter(
                          (t) => t.id !== item.todo.id
                        );
                        return api.daily.updateTodos({
                          date: item.date,
                          todos: updatedTodos,
                        });
                      })
                      .then(() => {
                        setRefreshOverdue((n) => n + 1);
                      })
                      .catch(() => {});
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

      {/* ── 导出面板 ── */}
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
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={todos.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="todo-items">
                {todos.map((todo, i) => (
                  <SortableTodoItem
                    key={todo.id}
                    todo={todo}
                    index={i}
                    dragOverIdx={dragOverIdx}
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
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <input
            type="text"
            placeholder="添加待办..."
            onKeyDown={addTodo}
            className="todo-input"
          />
        </>
      )}

      {/* Undo toast */}
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
