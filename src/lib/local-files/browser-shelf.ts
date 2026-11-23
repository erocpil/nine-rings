import type { BrowserDirectoryProvider } from "./browser-contract";
import { planBrowserDrop } from "./browser-drag";
import type { BrowserOperation } from "./browser-operation-contract";

export interface BrowserShelfEntry { rootId: string; rootName: string; parent: string; node: string }
export type BrowserShelfTarget = Omit<BrowserShelfEntry, "node">;
export const browserShelfId = ({ rootId, node }: BrowserShelfEntry) => JSON.stringify([rootId, node]);
export const browserShelfPath = (entry: BrowserShelfEntry) => [entry.rootName, entry.node].filter(Boolean).join("/");

export async function reviewBrowserShelf(
  entries: readonly BrowserShelfEntry[], target: BrowserShelfTarget, moving: boolean,
  provider: BrowserDirectoryProvider, canWrite: (rootId: string) => boolean, signal: AbortSignal,
) {
  if (!canWrite(target.rootId)) throw new Error("目标目录只读或授权已失效");
  const options = { sort: "name", query: "", showHidden: true } as const;
  await provider.page(target.rootId, target.parent, 0, options, signal);
  const groups = new Map<string, BrowserShelfEntry[]>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.rootId, entry.parent]);
    const group = groups.get(key) ?? [];
    group.push(entry); groups.set(key, group);
  }
  const invalid = new Map<string, string>(), operations: BrowserOperation[] = [];
  for (const entries of groups.values()) {
    signal.throwIfAborted();
    const source = entries[0];
    try {
      if (!canWrite(source.rootId)) throw new Error("来源目录只读或授权已失效");
      if (source.rootId === target.rootId && source.parent === target.parent) throw new Error("来源与目标为同一目录");
      const pending = new Set(entries.map(entry => entry.node)), exists = new Set<string>();
      let offset: number | null = 0;
      for (let page = 0; pending.size && offset !== null && page < 50; page++) {
        const listing = await provider.page(source.rootId, source.parent, offset, options, signal);
        for (const node of listing.nodes) if (pending.delete(node.id) && !node.directory && !node.link) exists.add(node.id);
        if (listing.next !== null && listing.next <= offset) break;
        offset = listing.next;
      }
      const nodes = entries.filter(entry => {
        if (exists.has(entry.node)) return true;
        invalid.set(browserShelfId(entry), "文件已失效、不是普通文件或超出核验范围");
        return false;
      }).map(entry => entry.node);
      if (nodes.length) operations.push(planBrowserDrop({ ...source, nodes }, target, moving));
    } catch (cause) {
      signal.throwIfAborted();
      for (const entry of entries) invalid.set(browserShelfId(entry), String(cause));
    }
  }
  return { invalid, operations };
}
