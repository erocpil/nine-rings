import { useState, useCallback, useRef } from "react";
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
  const [query, setQueryState] = useState("");
  const [results, setResults] = useState<SearchResults>({ notes: [], todos: [] });
  const [searching, setSearching] = useState(false);
  const searchRequestRef = useRef(0);

  const search = useCallback(async (q: string) => {
    const requestId = ++searchRequestRef.current;
    setQueryState(q);
    if (!q.trim()) {
      setResults({ notes: [], todos: [] });
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const [notes, todoHits] = await Promise.all([
        api.notes.search(q),
        api.daily.searchTodos(q),
      ]);
      if (requestId !== searchRequestRef.current) return;
      setResults({ notes, todos: todoHits });
    } catch (error) {
      if (requestId !== searchRequestRef.current) return;
      console.error("搜索失败:", error);
      setResults({ notes: [], todos: [] });
    } finally {
      if (requestId === searchRequestRef.current) {
        setSearching(false);
      }
    }
  }, []);

  const clear = useCallback(() => {
    searchRequestRef.current += 1;
    setQueryState("");
    setResults({ notes: [], todos: [] });
    setSearching(false);
  }, []);

  const setQuery = useCallback((value: string) => {
    if (!value) {
      clear();
      return;
    }
    setQueryState(value);
  }, [clear]);

  return { query, results, searching, search, setQuery, clear };
}
