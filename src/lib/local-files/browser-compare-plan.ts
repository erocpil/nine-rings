import type { BrowserDirectory, ComparedBrowserEntry } from "./browser-compare";
import { planBrowserDrop } from "./browser-drag";
import type { BrowserOperation } from "./browser-operation-contract";

export interface ComparedCopyItem { name: string; status: "ready" | "conflict" | "unknown"; detail: string }
const parentOf = (node: string) => node.split("/").slice(0, -1).join("/");
const join = (...parts: string[]) => parts.filter(Boolean).join("/");

export function planComparedCopies(
  rows: readonly ComparedBrowserEntry[], selected: ReadonlySet<string>,
  directories: [BrowserDirectory, BrowserDirectory], names: [string, string], from: 0 | 1,
) {
  const to = from === 0 ? 1 : 0;
  const source = directories[from], target = directories[to];
  const byName = new Map(rows.map(row => [row.name, row]));
  const items: ComparedCopyItem[] = [], groups = new Map<string, { source: string; target: string; nodes: string[] }>();
  for (const name of selected) {
    const row = byName.get(name);
    const node = from === 0 ? row?.left : row?.right;
    const other = from === 0 ? row?.right : row?.left;
    const parent = parentOf(name);
    const sourceParent = join(source.node, parent), targetParent = join(target.node, parent);
    if (!row || !node || node.directory || node.link || other?.link || row.status === "unknown" || row.status === "metadata") {
      items.push({ name, status: "unknown", detail: "没有可核验的普通文件差异" });
      continue;
    }
    if (other?.directory || row.status === "type" || (parent && byName.get(parent)?.status !== "directory")) {
      items.push({ name, status: "conflict", detail: "目标类型不同或父目录不存在" });
      continue;
    }
    if (row.status === "content" || (source.rootId === target.rootId && sourceParent === targetParent)) {
      items.push({ name, status: "unknown", detail: "内容相同或来源与目标重合" });
      continue;
    }
    items.push({ name, status: other ? "conflict" : "ready", detail: other ? "同名文件交由队列确认" : "可复制" });
    const group = groups.get(parent) ?? { source: sourceParent, target: targetParent, nodes: [] };
    group.nodes.push(node.id); groups.set(parent, group);
  }
  const operations: BrowserOperation[] = [...groups.values()].map(group => planBrowserDrop(
    { rootId: source.rootId, rootName: names[from], parent: group.source, nodes: group.nodes },
    { rootId: target.rootId, rootName: names[to], parent: group.target }, false,
  ));
  return { items, operations };
}
