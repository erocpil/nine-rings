import { localFileService, MAX_SOURCE_BYTES, type FileRoot } from "./service";
import type { SearchOptions } from "../search-matching";
import type { LocalSourceMatch } from "./search-matches";

export interface LocalFileSearchHit extends LocalSourceMatch { rootId: string; node: string; revision: string }
export interface LocalFileSearchProgress {
  entries: number; files: number; bytes: number; skipped: number; matches: number;
  current: string; limited: boolean; issues: string[];
}
export const LOCAL_SEARCH_LIMITS = { entries: 10000, files: 2000, bytes: 64 * 1024 * 1024, results: 2000 };
/** One request-owned worker, terminated immediately on cancellation; never scan on the editing thread. */
export async function searchLocalFiles(roots: FileRoot[], query: string, options: SearchOptions, showHidden: boolean, signal: AbortSignal, onProgress: (progress: LocalFileSearchProgress, hits: LocalFileSearchHit[]) => void, scope?: { rootId: string; node: string }) {
  if (!query.trim() || query.length > 1024) throw new Error("请输入不超过 1024 字符的搜索条件");
  signal.throwIfAborted();
  const worker = new Worker(new URL("../workers/local-file-search.worker.ts", import.meta.url), { type: "module" });
  let rejectPending: ((reason: unknown) => void) | null = null, sequence = 0;
  const abort = () => { worker.terminate(); rejectPending?.(new DOMException("搜索已取消", "AbortError")); };
  signal.addEventListener("abort", abort, { once: true });
  const progress: LocalFileSearchProgress = { entries: 0, files: 0, bytes: 0, skipped: 0, matches: 0, current: "", limited: false, issues: [] };
  const hits: LocalFileSearchHit[] = [];
  let lastReport = -Infinity;
  const report = (force = false) => {
    const now = performance.now();
    if (!force && now - lastReport < 80) return;
    lastReport = now;
    onProgress({ ...progress, issues: [...progress.issues] }, [...hits]);
  };
  const match = (source: string) => new Promise<{ rows: LocalSourceMatch[]; limited: boolean }>((resolve, reject) => {
    signal.throwIfAborted();
    const id = ++sequence;
    rejectPending = reject;
    worker.onmessage = event => { if (event.data.id !== id) return; rejectPending = null; if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result); };
    worker.onerror = () => reject(new Error("搜索工作线程不可用，请重试"));
    worker.postMessage({ id, source, query, options });
  });
  const stack = roots.filter(root => !scope || scope.rootId === root.id).map(root => ({ rootId: root.id, node: scope?.node ?? "", offset: 0 }));
  try {
    // Validate the pattern before scanning even an empty directory.
    await match("");
    scan: while (stack.length) {
      signal.throwIfAborted();
      if (progress.entries >= LOCAL_SEARCH_LIMITS.entries || progress.files >= LOCAL_SEARCH_LIMITS.files || progress.bytes >= LOCAL_SEARCH_LIMITS.bytes || hits.length >= LOCAL_SEARCH_LIMITS.results) { progress.limited = true; break; }
      const directory = stack.pop()!;
      progress.current = directory.node || "/";
      let page;
      try { page = await localFileService.list(directory.rootId, directory.node, directory.offset, { sort: "name", showHidden, query: "" }); }
      catch (cause) { signal.throwIfAborted(); progress.skipped++; if (progress.issues.length < 8) progress.issues.push(`${directory.node || "/"}：${String(cause)}`); report(); continue; }
      signal.throwIfAborted();
      if (page.next !== null) stack.push({ ...directory, offset: page.next });
      for (const node of page.nodes) {
        signal.throwIfAborted();
        if (progress.entries >= LOCAL_SEARCH_LIMITS.entries || progress.files >= LOCAL_SEARCH_LIMITS.files || hits.length >= LOCAL_SEARCH_LIMITS.results || progress.bytes >= LOCAL_SEARCH_LIMITS.bytes) { progress.limited = true; break; }
        progress.entries++;
        if (node.directory) { stack.push({ rootId: directory.rootId, node: node.id, offset: 0 }); continue; }
        progress.files++; progress.current = node.id;
        let size = 0;
        let snapshot;
        try {
          const fingerprint = await localFileService.stat(directory.rootId, node.id);
          signal.throwIfAborted();
          size = fingerprint.size;
          if (size > MAX_SOURCE_BYTES) throw new Error("文件超过 4 MiB，未读取正文");
          if (progress.bytes + size > LOCAL_SEARCH_LIMITS.bytes) { progress.limited = true; break scan; }
          // Charge attempted reads too: rejected binary files must not bypass the I/O budget.
          progress.bytes += size;
          snapshot = await localFileService.readSnapshot(directory.rootId, node.id);
        }
        catch (cause) { signal.throwIfAborted(); progress.skipped++; if (progress.issues.length < 8) progress.issues.push(`${node.id}：${String(cause)}`); continue; }
        signal.throwIfAborted();
        progress.bytes += Math.max(0, snapshot.size - size);
        if (progress.bytes > LOCAL_SEARCH_LIMITS.bytes) { progress.limited = true; break scan; }
        const result = await match(snapshot.source);
        signal.throwIfAborted();
        if (result.limited) progress.limited = true;
        for (const row of result.rows) {
          if (hits.length >= LOCAL_SEARCH_LIMITS.results) { progress.limited = true; break; }
          hits.push({ ...row, rootId: directory.rootId, node: node.id, revision: snapshot.revision });
        }
        progress.matches = hits.length; report();
      }
      report();
      if (progress.entries >= LOCAL_SEARCH_LIMITS.entries || progress.files >= LOCAL_SEARCH_LIMITS.files || progress.bytes >= LOCAL_SEARCH_LIMITS.bytes || hits.length >= LOCAL_SEARCH_LIMITS.results) { progress.limited = true; break; }
    }
    report(true);
    return progress;
  } finally { signal.removeEventListener("abort", abort); worker.terminate(); }
}
