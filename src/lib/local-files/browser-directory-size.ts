import { fileSegments } from "./file-model";
import type { BrowserDirectoryProvider } from "./browser-contract";

export interface BrowserDirectorySize {
  bytes: number; files: number; directories: number; pages: number; elapsedMs: number; measuredAt: number;
}
export interface BrowserDirectorySizeLimits { entries: number; depth: number; pages: number }
const defaults: BrowserDirectorySizeLimits = { entries: 100000, depth: 128, pages: 10000 };
/** Logical file lengths, counted by path. No content reads or speculative disk-allocation totals. */
export async function measureBrowserDirectorySize(
  provider: Pick<BrowserDirectoryProvider, "page">, rootId: string, node: string, signal: AbortSignal,
  onProgress: (value: BrowserDirectorySize & { current: string }) => void,
  limits: BrowserDirectorySizeLimits = defaults,
): Promise<BrowserDirectorySize> {
  fileSegments(node);
  if (!rootId || Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error("无效的目录统计范围");
  const started = performance.now();
  const result: BrowserDirectorySize = { bytes: 0, files: 0, directories: 0, pages: 0, elapsedMs: 0, measuredAt: 0 };
  const pending = [{ node, depth: 0 }];
  while (pending.length) {
    signal.throwIfAborted();
    const current = pending.pop()!, seen = new Set<string>();
    let offset: number | null = 0;
    while (offset !== null) {
      signal.throwIfAborted();
      if (++result.pages > limits.pages) throw new Error(`超过 ${limits.pages} 页统计预算，未生成完整结果`);
      const page = await provider.page(rootId, current.node, offset, { sort: "name", showHidden: true, query: "" }, signal);
      signal.throwIfAborted();
      for (const entry of page.nodes) {
        if (fileSegments(entry.name).length !== 1 || entry.id !== [current.node, entry.name].filter(Boolean).join("/")) throw new Error("目录返回了范围外的路径，统计已停止");
        if (seen.has(entry.id)) throw new Error("目录分页出现重复项，请刷新后重试");
        seen.add(entry.id);
        if (result.files + result.directories >= limits.entries) throw new Error(`超过 ${limits.entries} 项统计预算，未生成完整结果`);
        if (entry.directory) {
          if (current.depth >= limits.depth) throw new Error(`超过 ${limits.depth} 层统计预算，未生成完整结果`);
          result.directories++; pending.push({ node: entry.id, depth: current.depth + 1 });
        } else {
          if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !Number.isSafeInteger(result.bytes + entry.size)) throw new Error("文件大小未知或超过精确计量范围，未生成完整结果");
          result.files++; result.bytes += entry.size;
        }
      }
      if (page.next !== null && (!Number.isSafeInteger(page.next) || page.next <= offset)) throw new Error("目录分页未前进，请刷新后重试");
      offset = page.next;
      result.elapsedMs = Math.max(0, performance.now() - started);
      onProgress({ ...result, current: current.node });
      // Snapshot providers may resolve synchronously; let cancellation and painting run.
      if (result.pages % 32 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
  signal.throwIfAborted();
  return { ...result, elapsedMs: Math.max(0, performance.now() - started), measuredAt: Date.now() };
}

/** Session-only bounded cache. A result is an observation, never an atomic filesystem snapshot. */
export class BrowserDirectorySizeCache {
  private values = new Map<string, { rootId: string; result: BrowserDirectorySize }>();
  get(rootId: string, node: string): BrowserDirectorySize | undefined {
    const value = this.values.get(JSON.stringify([rootId, node]));
    return value && Date.now() - value.result.measuredAt < 60000 ? { ...value.result } : undefined;
  }
  put(rootId: string, node: string, result: BrowserDirectorySize) {
    const key = JSON.stringify([rootId, node]);
    this.values.delete(key); this.values.set(key, { rootId, result: { ...result } });
    while (this.values.size > 64) this.values.delete(this.values.keys().next().value!);
  }
  invalidate(rootId?: string) {
    for (const [key, value] of this.values) if (!rootId || rootId === value.rootId) this.values.delete(key);
  }
}
