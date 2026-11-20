import { fileSegments } from "./file-model";
import type { BrowserOperationHost, BrowserOperationLease, BrowserOperationRunner, BrowserProgress, BrowserItemResult, ConflictDecision } from "./browser-operation-contract";

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
    let conflictPolicy: ConflictDecision | undefined;
    for (const node of nodes) {
      if (signal.aborted) break;
      check();
      let targetName = operation.kind === "batch-rename" ? operation.names![node] : operation.kind === "rename" || operation.kind === "file" || operation.kind === "directory" ? name.trim() : node.split("/").pop()!;
      let originalTargetName = targetName;
      let duplicate = 1;
      let attempted = false;
      let release: (() => void) | undefined;
      try {
        if (node) {
          const lease = host.lock(operation.rootId, node); release = () => lease.release();
          await host.assertPathClean(operation.rootId, node, lease);
          check();
        }
        delete progress.transfer;
        progress.current = node || targetName; onProgress({ ...progress });
        for (;;) {
          if (signal.aborted) break;
          check();
          if (operation.kind !== "trash" && fileSegments(targetName).length !== 1) throw new Error("请输入单个文件或目录名称");
          if (operation.kind === "batch-rename" && nodes.some(other => other !== node && (operation.names![other].toLowerCase() === targetName.toLowerCase() || other.split("/").pop()!.toLowerCase() === targetName.toLowerCase()))) throw new Error("此名称被批量计划中的其它项目占用，请重新规划");
          let confirmed = false;
          let movedByEditor = false;
          try {
            emit({ node, targetName, status: "running" });
            attempted = true;
            const moveOpenFallback = async (write: Promise<string>, rootId: string, parent: string) => {
              try { return await write; }
              catch (error) {
                const relocate = host.files.relocateOpen;
                if (!relocate || nodes.length !== 1 || rootId !== operation.rootId || !/^(?:Error: )?PATH_IN_USE:/.test(String(error))) throw error;
                if (signal.aborted) throw new Error("MOVE_RELOCATION_NOT_WRITTEN: 已停止移动");
                try {
                  const target = await relocate(rootId, node, parent, targetName, signal);
                  movedByEditor = true;
                  return target;
                }
                catch (cause) {
                  if (/MOVE_RELOCATION_PUBLISHED:/.test(String(cause))) {
                    const targetNode = [parent, targetName].filter(Boolean).join("/");
                    host.notify({ kind: "move", rootId, node, targetRootId: rootId, targetNode });
                  }
                  throw cause;
                }
              }
            };
            if (operation.kind === "copy" || operation.kind === "move") {
              let acceptingProgress = true;
              const transfer = host.files.transfer(operation.rootId, node, operation.targetRootId, operation.targetParent, targetName, operation.kind === "move", transfer => {
                if (!acceptingProgress) return;
                progress.transfer = transfer;
                try { onProgress({ ...progress }); } catch { /* Isolate progress UI from disk writes. */ }
              }).finally(() => { acceptingProgress = false; });
              const next = operation.kind === "move" ? await moveOpenFallback(transfer, operation.targetRootId, operation.targetParent) : await transfer;
              confirmed = true;
              try { if (operation.kind === "move" && !movedByEditor) await host.reconcileMove(operation.rootId, node, operation.targetRootId, next, operation.targetRootName); }
              finally { host.notify({ kind: operation.kind === "move" ? "move" : "refresh", rootId: operation.rootId, node, targetRootId: operation.targetRootId, targetNode: next }); }
            } else if (operation.kind === "rename" || operation.kind === "batch-rename") {
              const write = host.files.move(operation.rootId, node, operation.parent, targetName);
              const next = operation.kind === "rename" ? await moveOpenFallback(write, operation.rootId, operation.parent) : await write;
              confirmed = true;
              try { if (!movedByEditor) await host.reconcileMove(operation.rootId, node, operation.rootId, next, operation.rootName); }
              finally { host.notify({ kind: "move", rootId: operation.rootId, node, targetRootId: operation.rootId, targetNode: next }); }
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
            if (confirmed || /MOVE_(?:COPY|RELOCATION)_PUBLISHED/.test(String(error))) throw error;
            if (/^(?:Error: )?(?:PATH_(?:IN_USE|BUSY)|MOVE_RELOCATION_NOT_WRITTEN):/.test(String(error))) { attempted = false; throw error; }
            if (!/TARGET_EXISTS|目标名称已存在/.test(String(error))) throw error;
            attempted = false; // Explicit no-overwrite conflict: nothing was written.
            if (signal.aborted) { emit({ node, targetName, status: "pending" }); return { ...progress, cancelled: true }; }
            const targetRoot = operation.kind === "copy" || operation.kind === "move" ? operation.targetRootId : operation.rootId;
            const targetParent = operation.kind === "copy" || operation.kind === "move" ? operation.targetParent : operation.parent;
            const decision = conflictPolicy ?? await onConflict(targetName, { ...(node ? { source: { rootId: operation.rootId, node } } : {}), target: { rootId: targetRoot, node: [targetParent, targetName].filter(Boolean).join("/") } });
            if ((decision.action === "skip" || decision.action === "keep-both") && decision.all) conflictPolicy = decision;
            if (decision.action === "stop") { emit({ node, targetName, status: "pending" }); return { ...progress, cancelled: true }; }
            if (decision.action === "skip") { progress.skipped++; emit({ node, targetName, status: "skipped" }); break; }
            if (decision.action === "replace") {
              if (operation.kind !== "copy" || !host.files.replace) throw new Error("当前操作不支持替换同名目标");
              if (signal.aborted) { emit({ node, targetName, status: "pending" }); return { ...progress, cancelled: true }; }
              check();
              const targetNode = [targetParent, targetName].filter(Boolean).join("/");
              const refresh = () => host.notify({ kind: "refresh", rootId: operation.rootId, node, targetRootId: targetRoot, targetNode });
              attempted = true;
              emit({ node, targetName, status: "running" });
              const { backupPath } = await host.files.replace({ rootId: operation.rootId, node, targetRootId: targetRoot, targetNode }, decision.expected, signal).catch(error => {
                if (/REPLACEMENT_NOT_WRITTEN:|PATH_IN_USE:|PATH_BUSY:/.test(String(error))) attempted = false;
                if (/REPLACEMENT_PUBLISHED:/.test(String(error))) refresh();
                throw error;
              });
              refresh();
              progress.completed++;
              emit({ node, targetName, status: "completed", backupPath });
              break;
            }
            if (decision.action === "keep-both") {
              if (operation.kind !== "copy" && operation.kind !== "move") throw new Error("当前操作不支持保留双方");
              if (++duplicate > 1000) throw new Error("自动名称尝试已达上限，请重新指定名称");
              targetName = browserDuplicateName(originalTargetName, duplicate);
            } else { targetName = decision.name.trim(); originalTargetName = targetName; duplicate = 1; }
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

/** Rename the incoming item; every candidate still uses native no-overwrite. */
export function browserDuplicateName(name: string, index: number) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${index})${name.slice(dot)}` : `${name} (${index})`;
}
