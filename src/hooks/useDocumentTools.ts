import { useCallback, useEffect, useState, type SetStateAction } from "react";
import type { SearchOptions } from "../lib/search-matching";
export type DocumentToolPanel = "find" | "jump" | null;

/** One mutually exclusive tool session; closing another tool never closes the
 * current one. Host adapters still own navigation and content transactions. */
export function useDocumentToolPanel(active: boolean) {
  const [panel, setPanel] = useState<DocumentToolPanel>(null);
  const setFindOpen = useCallback(
    (value: SetStateAction<boolean>) =>
      setPanel((current) => {
        const open =
          typeof value === "function" ? value(current === "find") : value;
        return open ? "find" : current === "find" ? null : current;
      }),
    [],
  );
  const setJumpOpen = useCallback(
    (value: SetStateAction<boolean>) =>
      setPanel((current) => {
        const open =
          typeof value === "function" ? value(current === "jump") : value;
        return open ? "jump" : current === "jump" ? null : current;
      }),
    [],
  );
  useEffect(() => {
    if (!active) setPanel(null);
  }, [active]);
  return {
    panel,
    setPanel,
    findOpen: panel === "find",
    jumpOpen: panel === "jump",
    setFindOpen,
    setJumpOpen,
  };
}

/** Plain UI state only: no document identity, file access or persisted marks. */
export function useDocumentFindControls() {
  const [query, setQueryState] = useState("");
  const [options, setOptionsState] = useState<SearchOptions>({});
  const [matchIndex, setMatchIndex] = useState(-1);
  const setQuery = useCallback((value: SetStateAction<string>) => {
    setQueryState(value);
    setMatchIndex(-1);
  }, []);
  const setOptions = useCallback((value: SetStateAction<SearchOptions>) => {
    setOptionsState(value);
    setMatchIndex(-1);
  }, []);
  const setCaseSensitive = useCallback(
    (value: boolean) =>
      setOptions((current) => ({ ...current, caseSensitive: value })),
    [setOptions],
  );
  const setWholeWord = useCallback(
    (value: boolean) =>
      setOptions((current) => ({ ...current, wholeWord: value })),
    [setOptions],
  );
  const setRegex = useCallback(
    (value: boolean) => setOptions((current) => ({ ...current, regex: value })),
    [setOptions],
  );
  return {
    query,
    setQuery,
    options,
    setOptions,
    matchIndex,
    setMatchIndex,
    setCaseSensitive,
    setWholeWord,
    setRegex,
  };
}
