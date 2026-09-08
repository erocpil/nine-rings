import { useState, useCallback, useRef } from "react";
import { api } from "../lib/api";
import { DAILY_NOTES_ENABLED, TODOS_ENABLED } from "../lib/workspace-features";
import { toSearchNote, type SearchNote } from "../lib/search-index-core";

export interface TodoHit {
  todo: { id: string; text: string; done: boolean };
  date: string;
}

export interface SearchResults {
  notes: SearchNote[];
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
      const [notes, documents, todoHits] = await Promise.all([
        DAILY_NOTES_ENABLED ? api.notes.searchSummaries(q) : Promise.resolve([]),
        api.docs.search({ text: q }),
        TODOS_ENABLED ? api.daily.searchTodos(q) : Promise.resolve([]),
      ]);
      if (requestId !== searchRequestRef.current) return;
      // The Web index starts with essays; native search may already include docs.
      // Merge by ID so the shared entry returns both without duplicate results.
      const uniqueNotes = new Map(notes.map((note) => [note.id, note]));
      for (const document of documents) uniqueNotes.set(document.id, toSearchNote(document));
      setResults({ notes: [...uniqueNotes.values()], todos: todoHits });
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
