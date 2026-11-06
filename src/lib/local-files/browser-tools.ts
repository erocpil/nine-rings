import { fileSegments, type FileNode, type LocalFileFingerprint } from "./service";
import type { localDirectoryProvider } from "./browser-provider";
type Provider = ReturnType<typeof localDirectoryProvider>;
export interface BrowserDirectory { rootId: string; node: string }
export interface ComparedBrowserEntry { name: string; left?: FileNode; right?: FileNode; status: "left" | "right" | "type" | "metadata" | "different" | "directory" | "unknown"; issue?: string }
export async function compareBrowserDirectories(provider: Provider, directories: [BrowserDirectory, BrowserDirectory], signal: AbortSignal, onProgress: (message: string) => void) {
  const sides: FileNode[][] = [];
  const metadata = new Map<FileNode, LocalFileFingerprint | string>();
  for (const [side, directory] of directories.entries()) {
    const nodes: FileNode[] = [], offsets = new Set<number>(); let offset: number | null = 0;
    while (offset !== null) {
      signal.throwIfAborted();
      if (offsets.has(offset)) throw new Error("目录分页发生重复，请刷新后重试");
      offsets.add(offset);
      const page = await provider.page(directory.rootId, directory.node, offset, { sort: "name", showHidden: true, query: "" }, signal);
      nodes.push(...page.nodes); offset = page.next;
      if (nodes.length > 10000 || (nodes.length === 10000 && offset !== null)) throw new Error("目录比较每侧最多 10000 项，请缩小范围");
      onProgress(`${side === 0 ? "左侧" : "右侧"}已枚举 ${nodes.length} 项`);
    }
    sides.push(nodes);
    const files = nodes.filter(node => !node.directory); let index = 0, done = 0;
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
  const right = new Map(sides[1].map(node => [node.name, node]));
  const rows: ComparedBrowserEntry[] = sides[0].map(left => {
    const match = right.get(left.name); right.delete(left.name);
    if (!match) return { name: left.name, left, status: "left" };
    if (left.directory !== match.directory) return { name: left.name, left, right: match, status: "type" };
    if (left.directory) return { name: left.name, left, right: match, status: "directory" };
    const a = metadata.get(left), b = metadata.get(match);
    if (!a || !b || typeof a === "string" || typeof b === "string") return { name: left.name, left, right: match, status: "unknown", issue: [a, b].filter(value => typeof value === "string").join("；") };
    return { name: left.name, left, right: match, status: a.size === b.size && a.modifiedMs === b.modifiedMs ? "metadata" : "different" };
  });
  rows.push(...[...right.values()].map(node => ({ name: node.name, right: node, status: "right" as const })));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export interface BatchRenameItem { node: string; name: string; next: string; changed: boolean }
export function planBrowserRename(nodes: readonly string[], template: string, start: number): BatchRenameItem[] {
  if (!template || template.length > 255 || !Number.isSafeInteger(start) || start < 0 || start > 1_000_000) throw new Error("请填写有效模板及 0–1000000 的起始编号");
  if (!nodes.length || nodes.length > 2000 || new Set(nodes).size !== nodes.length) throw new Error("请选择不超过 2000 个不同项目");
  if (/[{}]/.test(template.replace(/\{(?:name|ext|n)\}/g, ""))) throw new Error("仅支持 {name}、{ext}、{n} 占位符");
  const originals = new Set(nodes.map(node => node.split("/").pop()!.toLocaleLowerCase()));
  const targets = new Set<string>();
  return nodes.map((node, index) => {
    fileSegments(node); const name = node.split("/").pop()!;
    const at = name.lastIndexOf("."), stem = at > 0 ? name.slice(0, at) : name, ext = at > 0 ? name.slice(at) : "";
    const next = template.replace(/\{(name|ext|n)\}/g, (_, token: string) => token === "name" ? stem : token === "ext" ? ext : String(start + index));
    if (next !== next.trim() || next.length > 255 || fileSegments(next).length !== 1) throw new Error(`无效目标名称：${next}`);
    const key = next.toLocaleLowerCase();
    if (targets.has(key)) throw new Error(`目标名称重复：${next}`);
    if (next !== name && originals.has(key)) throw new Error(`目标被选中项占用：${next}；暂不支持交换名称或仅修改大小写`);
    targets.add(key); return { node, name, next, changed: next !== name };
  });
}
