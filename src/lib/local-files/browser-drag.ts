import { fileSegments } from "./file-model";
import type { BrowserOperation } from "./browser-operations";

export const BROWSER_DRAG_TYPE = "application/x-nine-rings-browser-files";
export interface BrowserDragSource { rootId: string; rootName: string; parent: string; nodes: readonly string[] }
/** A drop is only a proposal. The existing confirmation/queue owns all writes. */
export function planBrowserDrop(source: BrowserDragSource, target: { rootId: string; rootName: string; parent: string }, moving: boolean): BrowserOperation {
  if (!source.rootId || !target.rootId || !source.nodes.length || source.nodes.length > 2000) throw new Error("请选择不超过 2000 项");
  fileSegments(source.parent); fileSegments(target.parent);
  for (const node of source.nodes) {
    if (!fileSegments(node).length || node.split("/").slice(0, -1).join("/") !== source.parent) throw new Error("拖放来源已不在同一目录");
    if (source.rootId === target.rootId && (target.parent === node || target.parent.startsWith(`${node}/`))) throw new Error("不能拖放到自身或子目录");
  }
  if (source.rootId === target.rootId && source.parent === target.parent) throw new Error("来源和目标为同一目录，请选择其它目录");
  return { kind: moving ? "move" : "copy", ...source, nodes: [...new Set(source.nodes)], targetRootId: target.rootId, targetRootName: target.rootName, targetParent: target.parent };
}
