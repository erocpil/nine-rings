import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { localFileService, type FileRoot } from "../lib/local-files/service";
import { appendLocalFileNodes, isLocalFileDirectoryVisible, localFileListKey, sameLocalFilePage, visibleLocalFileDirectories, type ListedFilePage, type LocalFileListOptions } from "../lib/local-files/tree";

export function useLocalFileTree({ active, ready, roots, expanded, pages, options, busy, setPages, onError }: {
  active: boolean; ready: boolean; roots: FileRoot[]; expanded: ReadonlySet<string>;
  pages: Record<string, ListedFilePage>; options: LocalFileListOptions; busy: boolean;
  setPages: Dispatch<SetStateAction<Record<string, ListedFilePage>>>; onError: (message: string) => void;
}) {
  const latest = useRef({ active, ready, roots, expanded, pages, options, busy });
  latest.current = { active, ready, roots, expanded, pages, options, busy };
  const alive = useRef(true);
  const failures = useRef(new Set<string>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const readPage = useCallback(async (rootId: string, node = "", offset = 0) => {
    const requestedOptions = latest.current.options;
    const page = await localFileService.list(rootId, node, offset, requestedOptions);
    if (!alive.current || latest.current.options !== requestedOptions)
      throw new DOMException("目录显示条件已变化", "AbortError");
    return { ...page, listingKey: localFileListKey(requestedOptions) };
  }, []);
  const reload = useCallback(async (background = false, includeSnapshots = false) => {
    const snapshot = latest.current;
    const rootIds = new Set(snapshot.roots.map(root => root.id));
    const keys = visibleLocalFileDirectories(snapshot.expanded, snapshot.pages, rootIds, snapshot.options.showHidden);
    const updates: Array<{ key: string; before: ListedFilePage | undefined; page: ListedFilePage }> = [];
    const observedPages = { ...snapshot.pages };
    for (const key of keys) {
      if (!alive.current || latest.current.options !== snapshot.options) return;
      if (background && (!latest.current.active || document.visibilityState === "hidden" || !document.hasFocus() || latest.current.busy)) break;
      if (!isLocalFileDirectoryVisible(key, latest.current.expanded, observedPages, rootIds, snapshot.options.showHidden)) continue;
      const at = key.indexOf(":"), rootId = key.slice(0, at), node = key.slice(at + 1);
      if (background && !includeSnapshots && !localFileService.supportsDirectoryChanges(rootId)) continue;
      if (!latest.current.roots.some(root => root.id === rootId)) continue;
      try {
        let page = await readPage(rootId, node);
        // Retain the user's loaded extent instead of reverting a large folder
        // to its first page every time its contents change.
        const previousCount = snapshot.pages[key]?.nodes.length ?? 0;
        while (page.next !== null && page.nodes.length < previousCount) {
          const next = await readPage(rootId, node, page.next);
          page = { ...next, nodes: appendLocalFileNodes(page.nodes, next.nodes) };
        }
        failures.current.delete(key);
        observedPages[key] = page;
        if (snapshot.pages[key]?.listingKey !== page.listingKey || !sameLocalFilePage(snapshot.pages[key], page)) updates.push({ key, before: snapshot.pages[key], page });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!background) throw error;
        if (!failures.current.has(key)) { failures.current.add(key); onError(`目录自动刷新失败：${String(error)}`); }
      }
    }
    if (!alive.current || latest.current.options !== snapshot.options || !updates.length) return;
    setPages(current => {
      let next = current;
      for (const update of updates) {
        const rootId = update.key.slice(0, update.key.indexOf(":"));
        if (current[update.key] !== update.before || !latest.current.expanded.has(update.key) || !latest.current.roots.some(root => root.id === rootId)) continue;
        if (next === current) next = { ...current };
        next[update.key] = update.page;
      }
      return next;
    });
  }, [onError, readPage, setPages]);
  useEffect(() => {
    if (!active || !ready) return;
    let disposed = false, running = false;
    const refresh = async (includeSnapshots = false) => {
      if (disposed || running || document.visibilityState === "hidden" || !document.hasFocus() || latest.current.busy) return;
      running = true;
      try { await reload(true, includeSnapshots); } finally { running = false; }
    };
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), 5000);
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [active, ready, options, reload, busy]);
  return { readPage, reload };
}
