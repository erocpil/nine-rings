import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { localDateKey } from "../lib/local-date";
import type { Todo } from "../types/models";

interface OverdueTodo {
  todo: Todo;
  date: string;
}

interface OverdueTodosProps {
  open: boolean;
  disabled?: boolean;
  onClose: () => void;
  onOpenDate: (date: string) => void;
}

function getDescendantIds(todos: Todo[], id: string): Set<string> {
  const ids = new Set([id]);
  const pending = [id];
  while (pending.length > 0) {
    const parentId = pending.pop()!;
    for (const todo of todos) {
      if (todo.parent_id === parentId) {
        ids.add(todo.id);
        pending.push(todo.id);
      }
    }
  }
  return ids;
}

export function OverdueTodos({ open, disabled, onClose, onOpenDate }: OverdueTodosProps) {
  const [items, setItems] = useState<OverdueTodo[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const today = localDateKey();
      const pages = await api.daily.getAll();
      const overdue = pages.flatMap((page) =>
        page.date < today
          ? page.todos
              .filter((todo) => !todo.done)
              .map((todo) => ({ todo, date: page.date }))
          : []
      );
      overdue.sort((a, b) => b.date.localeCompare(a.date));
      setItems(overdue);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const updateTodo = async (item: OverdueTodo, updater: (todos: Todo[]) => Todo[]) => {
    if (disabled) return;
    const page = await api.daily.get(item.date);
    await api.daily.updateTodos({
      date: item.date,
      todos: updater(page.todos),
      todo_carryover: page.todo_carryover,
    });
    await load();
  };

  if (!open) return null;

  return (
    <div className="overdue-overlay" onClick={onClose}>
      <section className="overdue-panel" onClick={(event) => event.stopPropagation()}>
        <header className="overdue-header">
          <h3>过期待办</h3>
          <button className="overdue-close" onClick={onClose} title="关闭">✕</button>
        </header>

        {loading ? (
          <div className="overdue-empty">加载中…</div>
        ) : items.length === 0 ? (
          <div className="overdue-empty">没有过期待办</div>
        ) : (
          <div className="overdue-items">
            {items.map((item) => (
              <div key={`${item.date}-${item.todo.id}`} className="overdue-item">
                <input
                  type="checkbox"
                  checked={false}
                  disabled={disabled}
                  onChange={() => void updateTodo(item, (todos) =>
                    todos.map((todo) => todo.id === item.todo.id ? { ...todo, done: true } : todo)
                  )}
                  title="标记为完成"
                />
                <span className="overdue-text">{item.todo.text}</span>
                <button
                  className="overdue-date"
                  onClick={() => { onOpenDate(item.date); onClose(); }}
                  title="查看当天待办"
                >
                  {item.date}
                </button>
                <button
                  className="overdue-delete"
                  disabled={disabled}
                  onClick={() => void updateTodo(item, (todos) => {
                    const ids = getDescendantIds(todos, item.todo.id);
                    return todos.filter((todo) => !ids.has(todo.id));
                  })}
                  title="删除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
