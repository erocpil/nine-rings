import { pluginRuntime, type PluginActivation } from "../plugin-system/runtime";
import { fileSegments, localFileService } from "./service";
import { assertLocalPathClean, localPathContains, migrateLocalFileSessions } from "./operations";
import { migrateLocalFilePathState } from "./path-state";
import { localFileSessions } from "./session";
import { renameRecentLocalPath, removeRecentLocalPath } from "./recent";
import { renameLocalFocusTabPaths, removeLocalFocusTabPaths } from "../focus-tabs";
import { lockLocalOperation } from "./operation-lock";

export const FILE_BROWSER_MUTATION_EVENT = "nr:file-browser-mutation";
export interface BrowserMutation { kind: "refresh" | "move" | "trash"; rootId: string; node: string; targetRootId?: string; targetNode?: string }
export interface BrowserOperation {
  kind: "copy" | "move" | "rename" | "batch-rename" | "file" | "directory" | "trash";
  names?: Readonly<Record<string, string>>;
  rootId: string;
  rootName: string;
  parent: string;
  nodes: string[];
  targetRootId: string;
  targetRootName: string;
  targetParent: string;
}
export interface BrowserProgress { completed: number; skipped: number; total: number; current: string }
export interface BrowserItemResult {
  node: string; targetName: string;
  status: "pending" | "checking" | "running" | "completed" | "skipped" | "failed" | "uncertain";
  error?: string;
}
export type ConflictDecision = { action: "skip" } | { action: "stop" } | { action: "rename"; name: string };
const join = (parent: string, name: string) => [parent, name].filter(Boolean).join("/");
function notify(change: BrowserMutation) {
  window.dispatchEvent(new CustomEvent(FILE_BROWSER_MUTATION_EVENT, { detail: change }));
}
function migrate(rootId: string, node: string, targetRootId: string, targetNode: string, rootName: string) {
  migrateLocalFilePathState(rootId, node, targetNode, targetRootId);
  migrateLocalFileSessions(rootId, node, targetNode, targetRootId);
  // Optional UI persistence must not turn a completed disk operation into a retry.
  try { renameLocalFocusTabPaths(rootId, node, targetNode, targetRootId); } catch { /* optional */ }
  try { renameRecentLocalPath(rootId, node, targetNode, rootName, targetRootId); } catch { /* optional */ }
}
/** Fixed operation snapshot, sequential no-overwrite writes. Cancel only at item
 * boundaries; always reconcile a completed write before observing cancellation. */
export async function runBrowserOperation(owner: PluginActivation, operation: BrowserOperation, name: string, signal: AbortSignal,
  onProgress: (progress: BrowserProgress) => void,
  onConflict: (name: string) => Promise<ConflictDecision>,
  onItem?: (result: BrowserItemResult) => void,
) {
  const emit = (result: BrowserItemResult) => { try { onItem?.(result); } catch { /* A result observer must never change filesystem execution. */ } };
  const progress: BrowserProgress = { completed: 0, skipped: 0, total: operation.nodes.length || 1, current: "" };
  const check = () => { signal.throwIfAborted(); pluginRuntime.assert(owner, "filesystem.files.write"); };
  const nodes = operation.nodes.length ? [...operation.nodes] : [""];
  if (operation.kind === "batch-rename") {
    const names = nodes.map(node => operation.names?.[node] ?? "");
    if (names.some(value => fileSegments(value).length !== 1 || value !== value.trim()) || new Set(names.map(value => value.toLowerCase())).size !== names.length) throw new Error("无效或重复的批量重命名目标");
    for (const [index, value] of names.entries()) if (nodes.some((other, at) => at !== index && other.split("/").pop()!.toLowerCase() === value.toLowerCase())) throw new Error("批量目标仍被选中项占用，未执行");
  }
  if ((operation.kind === "rename" && operation.nodes.length !== 1) || (!["file", "directory"].includes(operation.kind) && !operation.nodes.length)) throw new Error("请选择要操作的路径");
  // Reject forged/cross-parent selections, roots and duplicate destructive work.
  if (new Set(nodes).size !== nodes.length || nodes.length > 2000) throw new Error("无效的选中路径");
  for (const node of nodes) {
    check();
    if (operation.kind === "file" || operation.kind === "directory") continue;
    if (!fileSegments(node).length || node.split("/").slice(0, -1).join("/") !== operation.parent) throw new Error("选中项不属于当前目录");
    onProgress({ ...progress, current: `${node}（检查未保存编辑）` });
    emit({ node, targetName: operation.names?.[node] ?? (operation.kind === "rename" ? name.trim() : node.split("/").pop()!), status: "checking" });
    try { await assertLocalPathClean(operation.rootId, node); emit({ node, targetName: operation.names?.[node] ?? (operation.kind === "rename" ? name.trim() : node.split("/").pop()!), status: "pending" }); }
    catch (error) { emit({ node, targetName: operation.names?.[node] ?? node.split("/").pop()!, status: "failed", error: String(error) }); throw error; }
  }
  for (const node of nodes) {
    if (signal.aborted) break;
    check();
    let targetName = operation.kind === "batch-rename" ? operation.names![node] : operation.kind === "rename" || operation.kind === "file" || operation.kind === "directory" ? name.trim() : node.split("/").pop()!;
    let attempted = false;
    let release: (() => void) | undefined;
    try {
      if (node) {
        const lease = lockLocalOperation(operation.rootId, node); release = lease.release;
        await assertLocalPathClean(operation.rootId, node, lease);
        check();
      }
      progress.current = node || targetName; onProgress({ ...progress });
      for (;;) {
        if (signal.aborted) break;
        check();
        if (operation.kind !== "trash" && fileSegments(targetName).length !== 1) throw new Error("请输入单个文件或目录名称");
        if (operation.kind === "batch-rename" && nodes.some(other => other !== node && (operation.names![other].toLowerCase() === targetName.toLowerCase() || other.split("/").pop()!.toLowerCase() === targetName.toLowerCase()))) throw new Error("此名称被批量计划中的其它项目占用，请重新规划");
        try {
          emit({ node, targetName, status: "running" });
          attempted = true;
          if (operation.kind === "copy" || operation.kind === "move") {
            const next = await localFileService.transfer(operation.rootId, node, operation.targetRootId, operation.targetParent, targetName, operation.kind === "move");
            if (operation.kind === "move") migrate(operation.rootId, node, operation.targetRootId, next, operation.targetRootName);
            notify({ kind: operation.kind === "move" ? "move" : "refresh", rootId: operation.rootId, node, targetRootId: operation.targetRootId, targetNode: next });
          } else if (operation.kind === "rename" || operation.kind === "batch-rename") {
            const next = await localFileService.move(operation.rootId, node, operation.parent, targetName);
            migrate(operation.rootId, node, operation.rootId, next, operation.rootName);
            notify({ kind: "move", rootId: operation.rootId, node, targetRootId: operation.rootId, targetNode: next });
          } else if (operation.kind === "trash") {
            await localFileService.trash(operation.rootId, node);
            for (const id of localFileSessions.keys()) if (localPathContains(operation.rootId, node, id)) localFileSessions.delete(id);
            try { removeRecentLocalPath(operation.rootId, node); removeLocalFocusTabPaths(operation.rootId, node); } catch { /* optional */ }
            notify({ kind: "trash", rootId: operation.rootId, node });
          } else {
            const next = await localFileService.create(operation.rootId, operation.parent, targetName, operation.kind === "directory");
            notify({ kind: "refresh", rootId: operation.rootId, node: next });
          }
          progress.completed++; emit({ node, targetName, status: "completed" }); break;
        } catch (error) {
          if (!/TARGET_EXISTS|目标名称已存在/.test(String(error))) throw error;
          attempted = false; // Explicit no-overwrite conflict: nothing was written.
          if (signal.aborted) { emit({ node, targetName, status: "pending" }); return { ...progress, cancelled: true }; }
          const decision = await onConflict(targetName);
          if (decision.action === "stop") { emit({ node, targetName, status: "pending" }); return { ...progress, cancelled: true }; }
          if (decision.action === "skip") { progress.skipped++; emit({ node, targetName, status: "skipped" }); break; }
          targetName = decision.name.trim();
        }
      }
      onProgress({ ...progress });
    } catch (error) {
      emit({ node, targetName, status: attempted ? "uncertain" : "failed", error: String(error) });
      throw error;
    } finally { release?.(); }
  }
  return { ...progress, cancelled: signal.aborted };
}

export function operationTarget(operation: BrowserOperation) {
  return join(operation.targetRootName, operation.targetParent);
}
