import { fileSegments } from "./file-model";
import type { BrowserOperationHost, BrowserOperationLease, BrowserOperationRunner, BrowserProgress, BrowserItemResult } from "./browser-operation-contract";

/** Shared guarded executor. Application hosts supply effects, never a second
 * implementation of conflict handling, cancellation or result classification. */
export function createBrowserOperationRunner<Lease extends BrowserOperationLease>(host: BrowserOperationHost<Lease>): BrowserOperationRunner {
  return async (operation, name, signal, onProgress, onConflict, onItem) => {
    const emit = (result: BrowserItemResult) => { try { onItem?.(result); } catch { /* A result observer must never change filesystem execution. */ } };
    const progress: BrowserProgress = { completed: 0, skipped: 0, total: operation.nodes.length || 1, current: "" };
    const check = () => { signal.throwIfAborted(); host.assertActive(); };
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
      try { await host.assertPathClean(operation.rootId, node); emit({ node, targetName: operation.names?.[node] ?? (operation.kind === "rename" ? name.trim() : node.split("/").pop()!), status: "pending" }); }
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
          const lease = host.lock(operation.rootId, node); release = () => lease.release();
          await host.assertPathClean(operation.rootId, node, lease);
          check();
        }
        progress.current = node || targetName; onProgress({ ...progress });
        for (;;) {
          if (signal.aborted) break;
          check();
          if (operation.kind !== "trash" && fileSegments(targetName).length !== 1) throw new Error("请输入单个文件或目录名称");
          if (operation.kind === "batch-rename" && nodes.some(other => other !== node && (operation.names![other].toLowerCase() === targetName.toLowerCase() || other.split("/").pop()!.toLowerCase() === targetName.toLowerCase()))) throw new Error("此名称被批量计划中的其它项目占用，请重新规划");
          let confirmed = false;
          try {
            emit({ node, targetName, status: "running" });
            attempted = true;
            if (operation.kind === "copy" || operation.kind === "move") {
              const next = await host.files.transfer(operation.rootId, node, operation.targetRootId, operation.targetParent, targetName, operation.kind === "move");
              confirmed = true;
              if (operation.kind === "move") await host.reconcileMove(operation.rootId, node, operation.targetRootId, next, operation.targetRootName);
              host.notify({ kind: operation.kind === "move" ? "move" : "refresh", rootId: operation.rootId, node, targetRootId: operation.targetRootId, targetNode: next });
            } else if (operation.kind === "rename" || operation.kind === "batch-rename") {
              const next = await host.files.move(operation.rootId, node, operation.parent, targetName);
              confirmed = true;
              await host.reconcileMove(operation.rootId, node, operation.rootId, next, operation.rootName);
              host.notify({ kind: "move", rootId: operation.rootId, node, targetRootId: operation.rootId, targetNode: next });
            } else if (operation.kind === "trash") {
              await host.files.trash(operation.rootId, node);
              confirmed = true;
              await host.reconcileTrash(operation.rootId, node);
              host.notify({ kind: "trash", rootId: operation.rootId, node });
            } else {
              const next = await host.files.create(operation.rootId, operation.parent, targetName, operation.kind === "directory");
              confirmed = true;
              host.notify({ kind: "refresh", rootId: operation.rootId, node: next });
            }
            progress.completed++; emit({ node, targetName, status: "completed" }); break;
          } catch (error) {
            if (confirmed || /MOVE_COPY_PUBLISHED/.test(String(error))) throw error;
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
  };
}
