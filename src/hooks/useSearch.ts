import { useState, useCallback } from "react";
import { api } from "../lib/api";
import type { Note } from "../types/models";

export interface TodoHit {
  todo: { id: string; text: string; done: boolean };
  date: string;
}

export interface SearchResults {
  notes: Note[];
  todos: TodoHit[];
}

/**
 * 搜索 Hook — 同时搜索笔记和待办，防抖在 SearchBar 组件中处理
 */
export function useSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({ notes: [], todos: [] });
  const [searching, setSearching] = useState(false);

  const search = useCallback(async (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setResults({ notes: [], todos: [] });
      return;
    }
    setSearching(true);
    try {
      const [notes, todoHits] = await Promise.all([
        api.notes.search(q),
        api.daily.searchTodos(q),
      ]);
      setResults({ notes, todos: todoHits });
    } finally {
      setSearching(false);
    }
  }, []);

  return { query, results, searching, search, setQuery };
}
