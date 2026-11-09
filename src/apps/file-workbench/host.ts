import { isTauriRuntime } from "../../lib/runtime";
import { pluginRuntime } from "../../lib/plugin-system/runtime";
import { workspacePanels } from "../../lib/plugin-system/panel-registry";
import { localFileService } from "../../lib/local-files/service";
import { createBrowserDirectoryProvider } from "../../lib/local-files/browser-provider-core";
import { BrowserOperationQueueCore } from "../../lib/local-files/browser-queue-core";
import { browserSettings } from "../../lib/local-files/browser-settings";
import { searchLocalFiles } from "../../lib/local-files/search";
import type { BrowserFileOpen } from "../../lib/local-files/browser-contract";
import type { BrowserWorkspaceHost } from "../../lib/local-files/browser-workspace-contract";

import { createLocalDraftStore } from "../../lib/local-files/recovery";
import type { LocalSourceHost } from "../../lib/local-files/source-host";

export const WORKBENCH_ID = "file-workbench.shell";
export const WORKBENCH_SETTINGS_PREFIX = "file-workbench:";
/** Independent file host. Uses the real service authorization engine, without
 * starting Nine Rings App, builtin plugins, document database or sync services. */
export function createWorkbenchHost(open: (request: BrowserFileOpen) => void) {
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate(WORKBENCH_ID, ["panels.present", "filesystem.files.read", "filesystem.files.write"]);
  workspacePanels.register(owner, { id: "browser", label: "文件工作台", icon: "compare", renderer: "file-browser" });
  const assertActive = () => pluginRuntime.assert(owner, "filesystem.files.read");
  const rejectWrite = () => { assertActive(); throw new Error("独立工作台尚未开放目录操作。"); };
  const queue = new BrowserOperationQueueCore({ assertActive: rejectWrite, execute: rejectWrite });
  const provider = createBrowserDirectoryProvider({
    assertActive, files: localFileService,
    async open(request, signal) { signal.throwIfAborted(); assertActive(); open(request); },
  });
  const mutations = new Set<(change: import("../../lib/local-files/browser-operation-contract").BrowserMutation) => void>();
  const source: LocalSourceHost = {
    assertActive,
    async read(rootId, node) { assertActive(); const result = await localFileService.readSnapshot(rootId, node); assertActive(); return result; },
    async write(rootId, node, text, base) {
      assertActive();
      const result = await localFileService.write(rootId, node, text, base);
      for (const notify of mutations) { try { notify({ kind: "refresh", rootId, node }); } catch { /* A viewer observer cannot fail a confirmed write. */ } }
      return result;
    },
    async saveCopy(name, text, base) { assertActive(); if (!isTauriRuntime()) return "unsupported"; const result = await localFileService.saveAs(name, text, base); assertActive(); return result; },
    canSaveOriginal: rootId => localFileService.canSaveOriginal(rootId),
    drafts: createLocalDraftStore("file-workbench-local-recovery", () => window.dispatchEvent(new Event("file-workbench:drafts")), { retainUntilResolved: true }),
  };
  const workspace: BrowserWorkspaceHost = {
    provider, queue, settings: browserSettings(WORKBENCH_SETTINGS_PREFIX), showQueueHistory: false,
    assertActive, roots: () => localFileService.roots(), choose: () => localFileService.choose(),
    addFiles: files => localFileService.addFiles(files),
    displayPath: (rootId, node) => localFileService.displayPath(rootId, node), absolutePaths: false,
    supportsDirectoryPicker: () => localFileService.supportsDirectoryPicker(),
    supportsDirectoryChanges: rootId => localFileService.supportsDirectoryChanges(rootId),
    canWrite: () => false, canTransfer: () => false, canTrash: () => false,
    search: searchLocalFiles,
    subscribeMutations(listener) { mutations.add(listener); return () => { mutations.delete(listener); }; },
  };
  let disposed = false;
  return { workspace, source, dispose() {
    if (disposed) return;
    disposed = true; mutations.clear(); queue.dispose(); pluginRuntime.deactivate(WORKBENCH_ID); localFileService.release();
  } };
}
