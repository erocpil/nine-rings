import { fileSegments } from "./file-model";
export { compareBrowserDirectories, type BrowserDirectory, type ComparedBrowserEntry } from "./browser-compare";

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
