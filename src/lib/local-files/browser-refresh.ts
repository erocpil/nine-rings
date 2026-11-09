import type { FileNode, FilePage, LocalFileFingerprint } from "./file-model";
import type { BrowserDirectoryProvider } from "./browser-contract";
import { appendLocalFileNodes, type LocalFileListOptions } from "./tree";

/** Refresh the loaded extent, never silently fall back to the first page. */
export async function readBrowserRefresh(provider: Pick<BrowserDirectoryProvider, "page" | "properties">, rootId: string, node: string, options: LocalFileListOptions, previousCount: number, visibleIds: readonly string[], signal: AbortSignal) {
  signal.throwIfAborted();
  let page = await provider.page(rootId, node, 0, options, signal);
  while (page.next !== null && page.nodes.length < Math.min(10000, previousCount)) {
    signal.throwIfAborted();
    const offset = page.next;
    const more = await provider.page(rootId, node, offset, options, signal);
    if (more.next !== null && (!Number.isSafeInteger(more.next) || more.next <= offset)) throw new Error("目录分页游标未前进，请手动刷新");
    const nodes = appendLocalFileNodes(page.nodes, more.nodes);
    if (nodes.length <= page.nodes.length && more.next !== null) throw new Error("目录分页没有新增条目，请手动刷新");
    page = { nodes, next: more.next };
  }
  signal.throwIfAborted();
  const visible = new Set(visibleIds.slice(0, 64));
  const properties: Record<string, LocalFileFingerprint> = {};
  const missing: FileNode[] = [];
  for (const item of page.nodes) if (!item.directory) {
    if (item.modifiedMs !== undefined) properties[item.id] = { size: item.size, modifiedMs: item.modifiedMs };
    else if (visible.has(item.id)) missing.push(item);
  }
  // Browser directory handles do not return metadata with a name-sorted list.
  // Inspect only visible rows, with bounded concurrency and no body reads.
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, missing.length) }, async () => {
    while (index < missing.length) {
      signal.throwIfAborted();
      const item = missing[index++];
      try { properties[item.id] = await provider.properties(rootId, item.id, signal); }
      catch { signal.throwIfAborted(); /* Unreadable metadata does not mean deletion. */ }
    }
  }));
  signal.throwIfAborted();
  return { page, properties };
}

export function browserRefreshScroll(before: readonly FileNode[], after: readonly FileNode[], top: number, rowHeight: number, height: number) {
  const start = Math.max(0, Math.floor(top / rowHeight));
  let target = top;
  for (let index = start; index < Math.min(before.length, start + 3); index++) {
    const at = after.findIndex(item => item.id === before[index].id);
    if (at >= 0) { target = top + (at - index) * rowHeight; break; }
  }
  return Math.max(0, Math.min(target, after.length * rowHeight - height));
}

/** A partial listing cannot prove that an unlisted selected item was deleted. */
export function browserRefreshSelection(selected: readonly string[], page: FilePage) {
  if (page.next !== null) return [...selected];
  const ids = new Set(page.nodes.map(item => item.id));
  return selected.filter(id => ids.has(id));
}
