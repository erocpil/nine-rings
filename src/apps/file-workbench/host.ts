import { createBrowserViewMenu } from "../../lib/local-files/browser-view-menu";
import { isTauriRuntime } from "../../lib/runtime";
import { pluginRuntime } from "../../lib/plugin-system/runtime";
import { workspacePanels } from "../../lib/plugin-system/panel-registry";
import { localFileService } from "../../lib/local-files/service";
import { createBrowserDirectoryProvider } from "../../lib/local-files/browser-provider-core";
import { createWorkbenchOperations } from "./operations";
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
  const mutations = new Set<(change: import("../../lib/local-files/browser-operation-contract").BrowserMutation) => void>();
  const notify = (change: import("../../lib/local-files/browser-operation-contract").BrowserMutation) => { for (const listener of mutations) { try { listener(change); } catch { /* Observers cannot change a confirmed filesystem result. */ } } };
  const drafts = createLocalDraftStore("file-workbench-local-recovery", () => window.dispatchEvent(new Event("file-workbench:drafts")), { retainUntilResolved: true });
  const operations = createWorkbenchOperations({ assertActive: () => { pluginRuntime.assert(owner, "filesystem.files.write"); if (!isTauriRuntime()) throw new Error("目录操作仅适用于桌面版授权目录。"); }, files: localFileService, notify }, drafts);
  const { queue } = operations;
  const provider = createBrowserDirectoryProvider({
    assertActive, files: localFileService,
    async open(request, signal) { signal.throwIfAborted(); operations.assertIdle(); open(request); },
  });
  const source: LocalSourceHost = {
    assertActive,
    async read(rootId, node) { operations.assertIdle(); const result = await localFileService.readSnapshot(rootId, node); assertActive(); return result; },
    async write(rootId, node, text, base) {
      operations.assertIdle();
      const result = await localFileService.write(rootId, node, text, base);
      for (const notify of mutations) { try { notify({ kind: "refresh", rootId, node }); } catch { /* A viewer observer cannot fail a confirmed write. */ } }
      return result;
    },
    async saveCopy(name, text, base) { assertActive(); if (!isTauriRuntime()) return "unsupported"; const result = await localFileService.saveAs(name, text, base); assertActive(); return result; },
    canSaveOriginal: rootId => localFileService.canSaveOriginal(rootId),
    drafts,
  };
  const viewMenu = createBrowserViewMenu();
  const workspace: BrowserWorkspaceHost = {
    viewMenu,
    provider, queue, settings: browserSettings(WORKBENCH_SETTINGS_PREFIX), showQueueHistory: false, presentation: "compact",
    assertActive, roots: () => localFileService.roots(), choose: () => localFileService.choose(),
    addFiles: files => localFileService.addFiles(files),
    async revokeRoot(rootId) { operations.assertIdle(); await localFileService.remove(rootId); assertActive(); },
    externalOpen: isTauriRuntime() ? { open: (rootId, node, chooseApplication) => localFileService.openExternal(rootId, node, chooseApplication) } : undefined,
    systemProperties: isTauriRuntime() ? async (rootId, node) => (await localFileService.fileProperties(rootId, node, true)).systemShown ?? false : undefined,
    displayPath: (rootId, node) => localFileService.displayPath(rootId, node), absolutePaths: isTauriRuntime(),
    supportsDirectoryPicker: () => localFileService.supportsDirectoryPicker(),
    supportsDirectoryChanges: rootId => localFileService.supportsDirectoryChanges(rootId),
    canWrite: rootId => isTauriRuntime() && localFileService.canRename(rootId), canTransfer: () => isTauriRuntime() && localFileService.canTransfer(), canTrash: () => isTauriRuntime() && localFileService.canTrash(),
    search: searchLocalFiles,
    subscribeMutations(listener) { mutations.add(listener); return () => { mutations.delete(listener); }; },
  };
  let disposed = false;
  return { workspace, source, viewMenu, operations, dispose() {
    if (disposed) return;
    disposed = true; mutations.clear(); operations.dispose(); pluginRuntime.deactivate(WORKBENCH_ID); localFileService.release();
  } };
}
