import { useEffect, useState } from "react";
import type { TodoHit } from "../hooks/useSearch";
import { extractSnippet } from "../lib/storage/idb-snippet";
import type { Note } from "../types/models";

const PAGE_SIZE = 80;

interface Props {
  notes: Note[];
  todos: TodoHit[];
  searchTerm: string;
  searching: boolean;
  onClose: () => void;
  onSelectNote: (note: Note, keepSearch: boolean, searchTerm: string) => void;
  onSelectTodo: (date: string) => void;
}

export function SearchResultsPanel({
  notes,
  todos,
  searchTerm,
  searching,
  onClose,
  onSelectNote,
  onSelectTodo,
}: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const total = notes.length + todos.length;
  const visibleNotes = notes.slice(0, visibleCount);
  const visibleTodos = todos.slice(0, Math.max(0, visibleCount - visibleNotes.length));

  useEffect(() => setVisibleCount(PAGE_SIZE), [notes, todos, searchTerm]);

  return (
    <div className="search-results" aria-label="搜索结果">
      <h3 className="search-results-header">
        <span>{searching ? "搜索中…" : `搜索结果（${total}）`}</span>
        <button type="button" onClick={onClose} aria-label="关闭搜索结果" title="关闭搜索结果">×</button>
      </h3>
      {notes.length > 0 && <div className="search-section-label">笔记</div>}
      {visibleNotes.map((note) => {
        const snippet = extractSnippet((note as Note & { search_text?: string }).search_text ?? "", searchTerm);
        return (
          <button
            type="button"
            key={note.id}
            className="search-hit"
            onClick={(event) => onSelectNote(note, event.ctrlKey || event.metaKey, searchTerm)}
          >
            <span className="search-hit-title">{note.title || "无标题"}</span>
            <span className="search-hit-date">{note.date}</span>
            {note.storagePath && <span className="search-hit-path">{note.storagePath}</span>}
            {snippet && <span className="search-hit-snippet" dangerouslySetInnerHTML={{ __html: snippet }} />}
          </button>
        );
      })}
      {todos.length > 0 && visibleTodos.length > 0 && <div className="search-section-label">待办</div>}
      {visibleTodos.map((hit) => (
        <button
          type="button"
          key={`todo-${hit.todo.id}`}
          className="search-hit"
          onClick={() => onSelectTodo(hit.date)}
        >
          <span className="search-hit-title">
            <span className={`todo-dot ${hit.todo.done ? "done" : ""}`}>
              {hit.todo.done ? "☑" : "☐"}
            </span>
            {hit.todo.text}
          </span>
          <span className="search-hit-date">{hit.date}</span>
        </button>
      ))}
      {visibleCount < total && (
        <button
          type="button"
          className="search-load-more"
          onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
        >
          显示更多（剩余 {total - visibleCount}）
        </button>
      )}
    </div>
  );
}
