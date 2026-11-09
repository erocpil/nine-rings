import { pluginRuntime, type PluginActivation } from "../plugin-system/runtime";
import { localFileService } from "./service";
import { assertLocalPathClean, localPathContains, migrateLocalFileSessions } from "./operations";
import { migrateLocalFilePathState } from "./path-state";
import { localFileSessions, invalidateLocalFileSessionMounts, checkpointLocalFilePath } from "./session";
import { mainViews } from "../plugin-system/main-view-registry";
import { renameRecentLocalPath, removeRecentLocalPath } from "./recent";
import { renameLocalFocusTabPaths, removeLocalFocusTabPaths } from "../focus-tabs";
import { lockLocalOperation } from "./operation-lock";

import { createBrowserOperationRunner } from "./browser-operation-core";
import type { BrowserMutation, BrowserOperation, BrowserProgress, BrowserItemResult, ConflictDecision } from "./browser-operation-contract";
export type { BrowserMutation, BrowserOperation, BrowserProgress, BrowserItemResult, ConflictDecision } from "./browser-operation-contract";
export { operationTarget } from "./browser-operation-contract";

export const FILE_BROWSER_MUTATION_EVENT = "nr:file-browser-mutation";
function notify(change: BrowserMutation) {
  window.dispatchEvent(new CustomEvent(FILE_BROWSER_MUTATION_EVENT, { detail: change }));
}
async function migrate(owner: PluginActivation, rootId: string, node: string, targetRootId: string, targetNode: string, rootName: string) {
  try { await checkpointLocalFilePath(rootId, node); } catch { /* Disk move already succeeded; retain the last checkpoint if UI storage failed. */ }
  const current = mainViews.getSnapshot().current;
  if (current?.renderer === "local-file" && localPathContains(rootId, node, `${current.data.rootId}:${current.data.nodeId}`)) invalidateLocalFileSessionMounts();
  migrateLocalFilePathState(rootId, node, targetNode, targetRootId);
  migrateLocalFileSessions(rootId, node, targetNode, targetRootId);
  // Optional UI persistence must not turn a completed disk operation into a retry.
  try { renameLocalFocusTabPaths(rootId, node, targetNode, targetRootId); } catch { /* optional */ }
  try { renameRecentLocalPath(rootId, node, targetNode, rootName, targetRootId); } catch { /* optional */ }
  mainViews.relocateLocalFile(owner, rootId, node, targetRootId, targetNode);
}
/** Nine Rings host binding. Shared operation semantics live in browser-operation-core. */
export async function runBrowserOperation(owner: PluginActivation, operation: BrowserOperation, name: string, signal: AbortSignal,
  onProgress: (progress: BrowserProgress) => void,
  onConflict: (name: string) => Promise<ConflictDecision>,
  onItem?: (result: BrowserItemResult) => void,
) {
  return createBrowserOperationRunner({
    assertActive: () => pluginRuntime.assert(owner, "filesystem.files.write"),
    files: localFileService,
    assertPathClean: assertLocalPathClean,
    lock: lockLocalOperation,
    reconcileMove: (rootId, node, targetRootId, targetNode, rootName) => migrate(owner, rootId, node, targetRootId, targetNode, rootName),
    reconcileTrash(rootId, node) {
      for (const id of localFileSessions.keys()) if (localPathContains(rootId, node, id)) localFileSessions.delete(id);
      try { removeRecentLocalPath(rootId, node); removeLocalFocusTabPaths(rootId, node); } catch { /* optional */ }
    },
    notify,
  })(operation, name, signal, onProgress, onConflict, onItem);
}
