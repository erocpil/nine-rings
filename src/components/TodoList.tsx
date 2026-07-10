import { useEffect, useRef, useState } from "react";
import type { Todo } from "../types/models";
import { uuid } from "../lib/uuid";
import { api } from "../lib/api";

interface OverdueItem {
  todo: Todo;
  date: string;
}

interface TodoListProps {
  todos: Todo[];
  onChange: (todos: Todo[]) => void;
}

export function TodoList({ todos, onChange }: TodoListProps) {
  const [undoTodo, setUndoTodo] = useState<{
    todo: Todo;
    previousTodos: Todo[];
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [overdueItems, setOverdueItems] = useState<OverdueItem[]>([]);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [refreshOverdue, setRefreshOverdue] = useState(0);

  // ── 导出 ──
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"text" | "md">("text");

  // ── 拖拽状态 ──
  const dragIdxRef = useRef<number | null>(null);
  const dragOverIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // ── 拉取过期待办 ──
  useEffect(() => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    api.daily.getAll().then((pages) => {
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
    }).catch(() => {});
  }, [refreshOverdue]);

  // Auto-dismiss undo after 5s
  useEffect(() => {
    if (!undoTodo) return;
    const timer = setTimeout(() => setUndoTodo(null), 5000);
    return () => clearTimeout(timer);
  }, [undoTodo]);

  const toggleTodo = (id: string) => {
    onChange(
      todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    );
  };

  const removeTodo = (id: string) => {
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;
    setUndoTodo({ todo, previousTodos: todos });
    onChange(todos.filter((t) => t.id !== id));
  };

  const undoRemove = () => {
    if (!undoTodo) return;
    onChange(undoTodo.previousTodos);
    setUndoTodo(null);
  };

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const arr = [...todos];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    onChange(arr);
  };

  // ── 拖拽事件处理 ──
  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    dragIdxRef.current = index;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    // 添加半透明效果
    (e.currentTarget as HTMLElement).classList.add("todo-dragging");
  };

  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIdx !== index) {
      setDragOverIdx(index);
      dragOverIdxRef.current = index;
    }
  };

  const handleDragLeave = () => {
    // 使用 setTimeout 避免闪烁
  };

  const handleDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIdxRef.current;
    setDragOverIdx(null);
    if (from !== null && from !== index) {
      reorder(from, index);
    }
    (e.currentTarget as HTMLElement).classList.remove("todo-dragging");
  };

  const handleDragEnd = () => {
    dragIdxRef.current = null;
    dragOverIdxRef.current = null;
    setDragOverIdx(null);
    // 清除所有拖拽状态
    document.querySelectorAll(".todo-dragging").forEach((el) => el.classList.remove("todo-dragging"));
  };

  const addTodo = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
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
    if (todo.done) return;
    setEditingId(todo.id);
    setEditText(todo.text);
  };

  const saveEdit = () => {
    if (!editingId) return;
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

    // 纯文本
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
    api.daily.get(item.date).then((page) => {
      const updatedTodos = page.todos.map((t) =>
        t.id === item.todo.id ? { ...t, done: !t.done } : t
      );
      return api.daily.updateTodos({ date: item.date, todos: updatedTodos });
    }).then(() => {
      setRefreshOverdue((n) => n + 1);
    }).catch(() => {});
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
          onClick={() => setExportOpen((v) => !v)}
          title={exportOpen ? "取消导出" : "导出待办"}
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
                <span className="todo-text overdue-text">{item.todo.text}</span>
                <span className="overdue-date">{formatDate(item.date)}</span>
                <button
                  className="todo-remove"
                  onClick={() => {
                    api.daily.get(item.date).then((page) => {
                      const updatedTodos = page.todos.filter(
                        (t) => t.id !== item.todo.id
                      );
                      return api.daily.updateTodos({
                        date: item.date,
                        todos: updatedTodos,
                      });
                    }).then(() => {
                      setRefreshOverdue((n) => n + 1);
                    }).catch(() => {});
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
          <div className="todo-items">
        {todos.map((todo, i) => (
          <div
            key={todo.id}
            className={`todo-item ${dragOverIdx === i ? "todo-drop-target" : ""}`}
            draggable={editingId !== todo.id}
            onDragStart={handleDragStart(i)}
            onDragOver={handleDragOver(i)}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop(i)}
            onDragEnd={handleDragEnd}
          >
            <span className="todo-drag-handle" title="拖拽排序">⋮⋮</span>
            <input
              type="checkbox"
              className="todo-checkbox"
              checked={todo.done}
              onChange={() => toggleTodo(todo.id)}
            />
            {editingId === todo.id ? (
              <input
                className="todo-edit-input"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit();
                  if (e.key === "Escape") cancelEdit();
                }}
                onBlur={saveEdit}
                autoFocus
              />
            ) : (
              <span
                className={`todo-text ${todo.done ? "done" : ""}`}
                onDoubleClick={() => startEdit(todo)}
                title="双击编辑"
              >
                {todo.text}
              </span>
            )}
            <button
              className="todo-remove"
              onClick={() => removeTodo(todo.id)}
              title="删除"
            >
              ×
            </button>
          </div>
        ))}
      </div>

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
