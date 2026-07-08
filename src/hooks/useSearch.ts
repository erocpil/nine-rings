import { useState, useCallback } from "react";
import { api } from "../lib/api";

/**
 * 搜索 Hook — 防抖 300ms
 * 搜索结果写回 store 由调用方控制
 */
export function useSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const search = useCallback(async (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await api.notes.search(q);
      setResults(res);
    } finally {
      setSearching(false);
    }
  }, []);

  return { query, results, searching, search, setQuery };
}
