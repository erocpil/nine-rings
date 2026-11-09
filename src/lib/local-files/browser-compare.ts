import { fileSegments, MAX_SOURCE_BYTES, type FileNode, type LocalFileFingerprint } from "./file-model";
import type { BrowserDirectoryProvider } from "./browser-contract";

export interface BrowserDirectory { rootId: string; node: string }
export interface ComparedBrowserEntry { name: string; left?: FileNode; right?: FileNode; status: "left" | "right" | "type" | "metadata" | "different" | "directory" | "unknown" | "content" | "content-different"; issue?: string }
export interface BrowserCompareOptions { depth: number; content: boolean; binary?: boolean }
type Provider = Pick<BrowserDirectoryProvider, "page" | "properties"> & Partial<Pick<BrowserDirectoryProvider, "contentDigest" | "digestByteLimit">>;
const MAX_ENTRIES = 10000, MAX_CONTENT_BYTES = 32 * 1024 * 1024;
const same = (a: LocalFileFingerprint, b: LocalFileFingerprint) => a.size === b.size && a.modifiedMs === b.modifiedMs;

/** Read-only plugin workflow. Bounds apply across the entire traversal, not per folder.
 * A failed/limited traversal must never turn into an apparently complete result. */
export async function compareBrowserDirectories(provider: Provider, directories: [BrowserDirectory, BrowserDirectory], signal: AbortSignal, onProgress: (message: string) => void, options: BrowserCompareOptions = { depth: 0, content: false }): Promise<ComparedBrowserEntry[]> {
  if (!Number.isInteger(options.depth) || options.depth < 0 || options.depth > 8) throw new Error("递归深度须为 0–8");
  const fileLimit = options.binary ? provider.digestByteLimit?.() ?? 16 * 1024 * 1024 : MAX_SOURCE_BYTES;
  if (!Number.isSafeInteger(fileLimit) || fileLimit <= 0 || fileLimit > 256 * 1024 * 1024) throw new Error("无效的摘要预算");
  const totalLimit = options.binary ? fileLimit * 2 : MAX_CONTENT_BYTES;
  const sides: Map<string, FileNode>[] = [];
  const metadata = new Map<FileNode, LocalFileFingerprint | string>();
  for (const [side, directory] of directories.entries()) {
    const nodes = new Map<string, FileNode>();
    const pending = [{ node: directory.node, prefix: "", level: 0 }];
    while (pending.length) {
      signal.throwIfAborted();
      const current = pending.shift()!, offsets = new Set<number>(); let offset: number | null = 0;
      while (offset !== null) {
        signal.throwIfAborted();
        if (offsets.has(offset)) throw new Error("目录分页发生重复，请刷新后重试");
        offsets.add(offset);
        const page = await provider.page(directory.rootId, current.node, offset, { sort: "name", showHidden: true, query: "" }, signal);
        signal.throwIfAborted();
        for (const node of page.nodes) {
          if (fileSegments(node.name).length !== 1 || node.id !== [current.node, node.name].filter(Boolean).join("/")) throw new Error("目录返回了范围外的路径");
          const relative = `${current.prefix}${node.name}`;
          if (nodes.has(relative)) throw new Error("目录列举出现重复项，请刷新后重试");
          nodes.set(relative, node);
          if (nodes.size > MAX_ENTRIES) throw new Error("目录比较每侧最多 10000 项，请缩小范围");
          if (node.directory && current.level < options.depth) pending.push({ node: node.id, prefix: `${relative}/`, level: current.level + 1 });
        }
        if (page.next !== null && (!Number.isSafeInteger(page.next) || page.next <= offset)) throw new Error("目录分页发生重复或未前进，请刷新后重试");
        offset = page.next;
        onProgress(`${side === 0 ? "左侧" : "右侧"}已枚举 ${nodes.size} 项`);
      }
    }
    sides.push(nodes);
    const files = [...nodes.values()].filter(node => !node.directory); let index = 0, done = 0;
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
      while (index < files.length) {
        signal.throwIfAborted(); const file = files[index++];
        try { metadata.set(file, await provider.properties(directory.rootId, file.id, signal)); }
        catch (reason) { signal.throwIfAborted(); metadata.set(file, String(reason)); }
        done++; if (done % 50 === 0 || done === files.length) onProgress(`${side === 0 ? "左侧" : "右侧"}已检查 ${done} / ${files.length} 个文件`);
      }
    }));
  }
  signal.throwIfAborted();
  const names = [...new Set([...sides[0].keys(), ...sides[1].keys()])].sort((a, b) => a.localeCompare(b));
  const rows: ComparedBrowserEntry[] = []; let contentBytes = 0, done = 0;
  for (const name of names) {
    signal.throwIfAborted();
    const left = sides[0].get(name), right = sides[1].get(name);
    const row: ComparedBrowserEntry = { name, left, right, status: !left ? "right" : !right ? "left" : left.directory !== right.directory ? "type" : left.directory ? "directory" : "unknown" };
    if (left && right && !left.directory && !right.directory) {
      const a = metadata.get(left), b = metadata.get(right);
      if (!a || !b || typeof a === "string" || typeof b === "string") row.issue = [a, b].filter(value => typeof value === "string").join("；");
      else if (!options.content) row.status = same(a, b) ? "metadata" : "different";
      else if (a.size > fileLimit || b.size > fileLimit || contentBytes + a.size + b.size > totalLimit) row.issue = `未读取：单文件最多 ${fileLimit / 1024 / 1024} MiB，本次累计最多 ${totalLimit / 1024 / 1024} MiB；不能据元信息判为内容相同`;
      else {
        contentBytes += a.size + b.size;
        try {
          if (!provider.contentDigest) throw new Error("此提供者不支持正文比较");
          // Sequential reads bound memory and allow cancellation between files.
          const l = await provider.contentDigest(directories[0].rootId, left.id, signal, options.binary);
          signal.throwIfAborted();
          const r = await provider.contentDigest(directories[1].rootId, right.id, signal, options.binary);
          signal.throwIfAborted();
          const afterL = await provider.properties(directories[0].rootId, left.id, signal);
          const afterR = await provider.properties(directories[1].rootId, right.id, signal);
          signal.throwIfAborted();
          if (!same(a, l) || !same(b, r) || !same(a, afterL) || !same(b, afterR)) throw new Error("比较期间文件已变化，请重新比较");
          row.status = l.digest === r.digest ? "content" : "content-different";
        } catch (reason) { signal.throwIfAborted(); row.issue = String(reason); }
      }
    }
    rows.push(row); done++;
    if (options.content) onProgress(`已比较 ${done} / ${names.length} 项 · 读取预算 ${(contentBytes / 1024 / 1024).toFixed(1)} / ${totalLimit / 1024 / 1024} MiB`);
  }
  return rows;
}
