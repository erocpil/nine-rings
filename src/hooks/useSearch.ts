import { useState, useCallback, useRef } from "react";
import { api } from "../lib/api";
import type { SearchNote } from "../lib/search-index-core";
import type { SearchOptions } from "../lib/search-matching";

export interface SearchResults {
  notes: SearchNote[];
}

/**
 * 搜索 Hook — 搜索文档，防抖在 SearchBar 组件中处理
 */
export function useSearch() {
  const [query, setQueryState] = useState("");
  const [results, setResults] = useState<SearchResults>({ notes: [] });
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const searchRequestRef = useRef(0);

  const search = useCallback(async (q: string, options?: SearchOptions) => {
    const requestId = ++searchRequestRef.current;
    setQueryState(q);
    setError("");
    if (!(options?.regex ? q : q.trim())) {
      setResults({ notes: [] });
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const notes = await api.notes.searchSummaries(q, options);
      if (requestId !== searchRequestRef.current) return;
      setResults({ notes });
    } catch (error) {
      if (requestId !== searchRequestRef.current) return;
      console.error("搜索失败:", error);
      setError(`搜索失败：${String(error)}`);
      setResults({ notes: [] });
    } finally {
      if (requestId === searchRequestRef.current) {
        setSearching(false);
      }
    }
  }, []);

  const clear = useCallback(() => {
    searchRequestRef.current += 1;
    setQueryState("");
    setResults({ notes: [] });
    setSearching(false);
    setError("");
  }, []);

  const setQuery = useCallback((value: string) => {
    if (!value) {
      clear();
      return;
    }
    setQueryState(value);
  }, [clear]);

  return { query, results, searching, error, search, setQuery, clear };
}
