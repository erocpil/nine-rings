import { parseDraftPath, protectedPathsOverlap } from "../../lib/local-files/workbench-path-protection";
import { createBrowserOperationRunner } from "../../lib/local-files/browser-operation-core";
import { BrowserOperationQueueCore, browserJobSettled } from "../../lib/local-files/browser-queue-core";
import { lockLocalOperation } from "../../lib/local-files/operation-lock";
import type { BrowserOperationHost, BrowserOperationLease } from "../../lib/local-files/browser-operation-contract";
import type { LocalDraftStore } from "../../lib/local-files/recovery";

/** Open editor paths are protected natively. Recovery drafts are checked by
 * canonical path here and never silently moved or discarded. */
export function createWorkbenchOperations(host: Pick<BrowserOperationHost<BrowserOperationLease>, "assertActive" | "files" | "notify"> & Partial<Pick<BrowserOperationHost<BrowserOperationLease>, "reconcileMove">> & { resolvePath?: (rootId: string, node: string) => Promise<string> }, drafts: LocalDraftStore) {
  let disposed = false;
  const assertActive = () => { if (disposed) throw new Error("工作台已关闭"); host.assertActive(); };
  const clean = async (rootId: string, node: string) => {
    assertActive();
    const unresolved = await drafts.list();
    if (unresolved.length) {
      if (!host.resolvePath) throw new Error("存在未处理的恢复草稿；请先通过“恢复草稿”处理，再执行目录操作。");
      const target = await host.resolvePath(rootId, node);
      for (const draft of unresolved) {
        const path = parseDraftPath(draft.identity);
        const protectedPath = await host.resolvePath(path.rootId, path.node);
        if (protectedPathsOverlap(target, protectedPath)) throw new Error(`PATH_IN_USE: 此路径关联恢复草稿“${path.node}”；请先保存或处理相关草稿。`);
      }
    }
    assertActive();
  };
  const destination = async <T>(rootId: string, node: string, action: () => Promise<T>): Promise<T> => {
    const lease = lockLocalOperation(rootId, node);
    try { await clean(rootId, node); return await action(); } finally { lease.release(); }
  };
  const path = (parent: string, name: string) => [parent, name.trim()].filter(Boolean).join("/");
  const replace = host.files.replace?.bind(host.files);
  const relocateOpen = host.files.relocateOpen?.bind(host.files);
  const runner = createBrowserOperationRunner({
    assertActive,
    assertPathClean: clean,
    lock: lockLocalOperation,
    files: {
      transfer: (rootId, node, targetRootId, parent, name, moving, onProgress) => destination(targetRootId, path(parent, name), () => host.files.transfer(rootId, node, targetRootId, parent, name, moving, onProgress)),
      replace: replace && (async (paths, expected, signal) => {
        let dispatched = false;
        try {
          return await destination(paths.targetRootId, paths.targetNode, () => {
            signal.throwIfAborted();
            dispatched = true;
            return replace(paths, expected, signal);
          });
        } catch (error) {
          if (!dispatched) throw new Error(`REPLACEMENT_NOT_WRITTEN: ${String(error)}`);
          throw error;
        }
      }),
      move: (rootId, node, parent, name) => destination(rootId, path(parent, name), () => host.files.move(rootId, node, parent, name)),
      relocateOpen: relocateOpen && ((rootId, node, parent, name, signal) => destination(rootId, path(parent, name), () => relocateOpen(rootId, node, parent, name, signal))),
      create: (rootId, parent, name, directory) => destination(rootId, path(parent, name), () => host.files.create(rootId, parent, name, directory)),
      trash: (rootId, node) => host.files.trash(rootId, node),
    },
    reconcileMove: host.reconcileMove ?? (async () => {}),
    reconcileTrash: () => {}, notify: host.notify,
  });
  const queue = new BrowserOperationQueueCore({ assertActive, execute: runner });
  const busy = () => queue.getSnapshot().some(job => !browserJobSettled(job));
  const assertIdle = () => { if (disposed) throw new Error("工作台已关闭"); if (busy()) throw new Error("目录操作尚未结束，请在操作队列中等待完成或停止，再打开文件或退出。"); };
  return { queue, busy, assertIdle, assertPathClean: clean, dispose() { disposed = true; queue.dispose(); } };
}
