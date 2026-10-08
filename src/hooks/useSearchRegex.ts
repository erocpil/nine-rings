import { useEffect, useState } from "react";
import {
  initializeSearchRegex,
  searchRegexReady,
} from "../lib/search-matching";

export function useSearchRegex(enabled: boolean) {
  const [ready, setReady] = useState(searchRegexReady);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled || ready) return;
    let active = true;
    void initializeSearchRegex()
      .then(() => {
        if (active) {
          setReady(true);
          setError("");
        }
      })
      .catch((reason) => {
        if (active) setError(`正则引擎加载失败：${String(reason)}`);
      });
    return () => {
      active = false;
    };
  }, [enabled, ready]);
  return { ready, error };
}
