import React from "react";
import type { Todo } from "../types/models";

interface TodoListProps {
  todos: Todo[];
  onChange: (todos: Todo[]) => void;
}

export function TodoList({ todos, onChange }: TodoListProps) {
  const toggleTodo = (id: string) => {
    onChange(
      todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    );
  };

  const removeTodo = (id: string) => {
    onChange(todos.filter((t) => t.id !== id));
  };

  const addTodo = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const input = e.currentTarget;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    onChange([
      ...todos,
      { id: crypto.randomUUID(), text, done: false, order: todos.length },
    ]);
  };

  return (
    <div className="todo-list">
      <h3 className="section-title">今日待办</h3>
      <div className="todo-items">
        {todos.map((todo) => (
          <label key={todo.id} className="todo-item">
            <input
              type="checkbox"
              checked={todo.done}
              onChange={() => toggleTodo(todo.id)}
            />
            <span className={todo.done ? "done" : ""}>{todo.text}</span>
            <button
              className="todo-remove"
              onClick={() => removeTodo(todo.id)}
            >
              ×
            </button>
          </label>
        ))}
      </div>
      <input
        type="text"
        placeholder="添加待办..."
        onKeyDown={addTodo}
        className="todo-input"
      />
    </div>
  );
}
