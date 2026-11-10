import { createBrowserOperationRunner } from "../../lib/local-files/browser-operation-core";
import { BrowserOperationQueueCore, browserJobSettled } from "../../lib/local-files/browser-queue-core";
import { lockLocalOperation } from "../../lib/local-files/operation-lock";
import type { BrowserOperationHost, BrowserOperationLease } from "../../lib/local-files/browser-operation-contract";
import type { LocalDraftStore } from "../../lib/local-files/recovery";

/** Standalone host policy: there is one editor, and browsing starts only after
 * its leave checkpoint. Unresolved drafts are retained, never silently moved. */
export function createWorkbenchOperations(host: Pick<BrowserOperationHost<BrowserOperationLease>, "assertActive" | "files" | "notify">, drafts: LocalDraftStore) {
  let disposed = false;
  const assertActive = () => { if (disposed) throw new Error("工作台已关闭"); host.assertActive(); };
  const clean = async () => {
    assertActive();
    if ((await drafts.list()).length) throw new Error("存在未处理的恢复草稿；请先通过“恢复草稿”保存或下载并处理，再执行目录操作。");
    assertActive();
  };
  const destination = async <T>(rootId: string, node: string, action: () => Promise<T>): Promise<T> => {
    const lease = lockLocalOperation(rootId, node);
    try { await clean(); return await action(); } finally { lease.release(); }
  };
  const path = (parent: string, name: string) => [parent, name.trim()].filter(Boolean).join("/");
  const runner = createBrowserOperationRunner({
    assertActive,
    assertPathClean: clean,
    lock: lockLocalOperation,
    files: {
      transfer: (rootId, node, targetRootId, parent, name, moving) => destination(targetRootId, path(parent, name), () => host.files.transfer(rootId, node, targetRootId, parent, name, moving)),
      move: (rootId, node, parent, name) => destination(rootId, path(parent, name), () => host.files.move(rootId, node, parent, name)),
      create: (rootId, parent, name, directory) => destination(rootId, path(parent, name), () => host.files.create(rootId, parent, name, directory)),
      trash: (rootId, node) => host.files.trash(rootId, node),
    },
    // No inactive editor sessions are cached in this host. Any unsaved content
    // is covered by the draft barrier above, including descendants and aliases.
    reconcileMove: async () => {}, reconcileTrash: () => {}, notify: host.notify,
  });
  const queue = new BrowserOperationQueueCore({ assertActive, execute: runner });
  const busy = () => queue.getSnapshot().some(job => !browserJobSettled(job));
  const assertIdle = () => { if (disposed) throw new Error("工作台已关闭"); if (busy()) throw new Error("目录操作尚未结束，请在操作队列中等待完成或停止，再打开文件或退出。"); };
  return { queue, busy, assertIdle, dispose() { disposed = true; queue.dispose(); } };
}
