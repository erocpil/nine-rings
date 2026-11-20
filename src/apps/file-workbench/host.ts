import { canonicalChildPath } from "../../lib/local-files/workbench-path-protection";
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
import { invoke } from "@tauri-apps/api/core";
import { isLocalFileReadOnly } from "../../lib/local-files/access";
import { moveWorkbenchFilePreferences, WORKBENCH_SETTINGS_PREFIX } from "./file-path-state";
import type { ReplacementPaths, ReplacementReview } from "../../lib/local-files/browser-operation-contract";

export const WORKBENCH_ID = "file-workbench.shell";
/** Independent file host. Uses the real service authorization engine, without
 * starting Nine Rings App, builtin plugins, document database or sync services. */
export function createWorkbenchHost(open: (request: BrowserFileOpen) => void | Promise<void>, afterSave?: (rootId: string, node: string) => Promise<void>, directoryOperationsAllowed: () => boolean = () => true) {
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate(WORKBENCH_ID, ["panels.present", "filesystem.files.read", "filesystem.files.write"]);
  workspacePanels.register(owner, { id: "browser", label: "文件工作台", icon: "compare", renderer: "file-browser" });
  const assertActive = () => pluginRuntime.assert(owner, "filesystem.files.read");
  const mutations = new Set<(change: import("../../lib/local-files/browser-operation-contract").BrowserMutation) => void>();
  const notify = (change: import("../../lib/local-files/browser-operation-contract").BrowserMutation) => { for (const listener of mutations) { try { listener(change); } catch { /* Observers cannot change a confirmed filesystem result. */ } } };
  const drafts = createLocalDraftStore("file-workbench-local-recovery", () => {
    window.dispatchEvent(new Event("file-workbench:drafts"));
    try { localStorage.setItem("file-workbench:drafts-revision", crypto.randomUUID()); } catch { /* The confirmed IndexedDB transaction remains authoritative. */ }
  }, { retainUntilResolved: true });
  const replacementsSupported = isTauriRuntime() && /^(Mac|Linux)/.test(navigator.platform);
  const assertReplacementTarget = (paths: ReplacementPaths) => {
    pluginRuntime.assert(owner, "filesystem.files.write");
    if (isLocalFileReadOnly(paths.targetRootId, paths.targetNode)) throw new Error("REPLACEMENT_NOT_WRITTEN: 目标文件或目录为只读");
  };
  const operations = createWorkbenchOperations({ assertActive: () => { pluginRuntime.assert(owner, "filesystem.files.write"); if (!isTauriRuntime()) throw new Error("目录操作仅适用于桌面版授权目录。"); }, files: {
    ...localFileService,
    replace: replacementsSupported ? (paths, expected) => {
      assertReplacementTarget(paths);
      return invoke<{ backupPath: string }>("workbench_replace_file", { paths, expected });
    } : undefined,
    relocateOpen: isTauriRuntime() ? (rootId, node, parent, name, signal) => {
      if (signal.aborted) throw new Error("MOVE_RELOCATION_NOT_WRITTEN: 已停止移动");
      if (isLocalFileReadOnly(rootId, [parent, name].filter(Boolean).join("/"))) throw new Error("MOVE_RELOCATION_NOT_WRITTEN: 目标为只读");
      return invoke<string>("workbench_move_open_file", { rootId, node, parent, name });
    } : undefined,
  }, notify, resolvePath: async (rootId, node) => canonicalChildPath(await localFileService.displayPath(rootId, ""), node),
  async reconcileMove(rootId, node, targetRootId, targetNode) {
    moveWorkbenchFilePreferences(`${rootId}:${node}`, `${targetRootId}:${targetNode}`);
  } }, drafts);
  const { queue } = operations;
  const provider = createBrowserDirectoryProvider({
    assertActive, files: localFileService,
    async open(request, signal) { signal.throwIfAborted(); operations.assertIdle(); await open(request); },
  });
  const source: LocalSourceHost = {
    assertActive,
    async read(rootId, node) { operations.assertIdle(); const result = await localFileService.readSnapshot(rootId, node); assertActive(); return result; },
    async stat(rootId, node) {
      if (!localFileService.supportsDirectoryChanges(rootId)) return null;
      const result = await localFileService.stat(rootId, node); assertActive(); return result;
    },
    async write(rootId, node, text, base) {
      operations.assertIdle();
      const result = await localFileService.write(rootId, node, text, base);
      for (const notify of mutations) { try { notify({ kind: "refresh", rootId, node }); } catch { /* A viewer observer cannot fail a confirmed write. */ } }
      if (afterSave) await afterSave(rootId, node).catch(cause => console.error("Saved file notification failed", cause));
      return result;
    },
    async saveCopy(name, text, base) { assertActive(); if (!isTauriRuntime()) return "unsupported"; const result = await localFileService.saveAs(name, text, base); assertActive(); return result; },
    canSaveOriginal: rootId => localFileService.canSaveOriginal(rootId),
    drafts,
  };
  const viewMenu = createBrowserViewMenu();
  const workspace: BrowserWorkspaceHost = {
    viewMenu,
    openEditors: isTauriRuntime() ? async files => {
      const signal = new AbortController().signal;
      let opened = 0;
      for (const file of files) {
        try {
          assertActive(); operations.assertIdle();
          await provider.open(file.rootId, file.rootName, file.node, signal);
          opened++;
        } catch (cause) {
          throw new Error(`已打开 ${opened}/${files.length} 个文件；打开“${file.node.name}”失败：${String(cause)}`);
        }
      }
    } : undefined,
    provider, queue, settings: browserSettings(WORKBENCH_SETTINGS_PREFIX), showQueueHistory: false, presentation: "compact",
    assertActive, roots: () => localFileService.roots(), choose: () => localFileService.choose(),
    addFiles: files => localFileService.addFiles(files),
    async revokeRoot(rootId) { operations.assertIdle(); if (!directoryOperationsAllowed()) throw new Error("请先关闭独立编辑器，再撤销目录授权。"); await localFileService.remove(rootId); assertActive(); },
    externalOpen: isTauriRuntime() ? { open: (rootId, node, chooseApplication) => localFileService.openExternal(rootId, node, chooseApplication) } : undefined,
    systemProperties: isTauriRuntime() ? async (rootId, node) => (await localFileService.fileProperties(rootId, node, true)).systemShown ?? false : undefined,
    displayPath: (rootId, node) => localFileService.displayPath(rootId, node), absolutePaths: isTauriRuntime(),
    supportsDirectoryPicker: () => localFileService.supportsDirectoryPicker(),
    supportsDirectoryChanges: rootId => localFileService.supportsDirectoryChanges(rootId),
    canWrite: rootId => isTauriRuntime() && localFileService.canRename(rootId), canTransfer: () => isTauriRuntime() && localFileService.canTransfer(), canTrash: () => isTauriRuntime() && localFileService.canTrash(),
    previewReplacement: replacementsSupported ? async paths => {
      assertReplacementTarget(paths);
      await operations.assertPathClean(paths.rootId, paths.node);
      await operations.assertPathClean(paths.targetRootId, paths.targetNode);
      assertReplacementTarget(paths);
      return invoke<ReplacementReview>("workbench_preview_replacement", { paths });
    } : undefined,
    search: searchLocalFiles,
    subscribeMutations(listener) { mutations.add(listener); return () => { mutations.delete(listener); }; },
  };
  let disposed = false;
  return { workspace, source, viewMenu, operations, receiveMutation: notify, dispose() {
    if (disposed) return;
    disposed = true; mutations.clear(); operations.dispose(); pluginRuntime.deactivate(WORKBENCH_ID); localFileService.release();
  } };
}
