import { localFileService } from "./service";
import { assertLocalPathClean, migrateLocalFileSessions } from "./operations";
import { migrateLocalFilePathState } from "./path-state";
import { invalidateLocalFileSessionMounts } from "./session";
import { renameLocalFocusTabPaths } from "../focus-tabs";
import { renameRecentLocalPath } from "./recent";
import { mainViews } from "../plugin-system/main-view-registry";
import { workspacePanels } from "../plugin-system/panel-registry";
import { LOCAL_FILE_VIEW_ID } from "../plugin-system/builtin-local-files";

const renamedFocus = new Set<string>();
export function consumeRenamedFileFocus(identity: string) { const present = renamedFocus.has(identity); renamedFocus.delete(identity); return present; }

export const LOCAL_FILE_RENAMED_EVENT = "nine-rings:local-file-renamed";
export interface LocalFileRename { rootId: string; oldNode: string; nodeId: string; name: string }

/** One rename transaction for title fields. Reject dirty files first; migrate
 * device state before opening the new identity. Tree widgets only refresh UI. */
export async function renameLocalDocument(rootId: string, oldNode: string, requested: string) {
  const name = requested.trim();
  if (name === oldNode.split("/").pop()) return;
  if (!localFileService.canRename(rootId)) throw new Error("目录快照无法重命名，请重新授权原目录。");
  await assertLocalPathClean(rootId, oldNode);
  const { nodeId } = await localFileService.rename(rootId, oldNode, name);
  migrateLocalFilePathState(rootId, oldNode, nodeId);
  invalidateLocalFileSessionMounts();
  migrateLocalFileSessions(rootId, oldNode, nodeId);
  renameLocalFocusTabPaths(rootId, oldNode, nodeId);
  renameRecentLocalPath(rootId, oldNode, nodeId);
  const event: LocalFileRename = { rootId, oldNode, nodeId, name };
  window.dispatchEvent(new CustomEvent(LOCAL_FILE_RENAMED_EVENT, { detail: event }));
  const current = mainViews.getSnapshot().current;
  if (current?.renderer === "local-file" && current.data.rootId === rootId && current.data.nodeId === oldNode) {
    renamedFocus.add(`${rootId}:${nodeId}`);
    mainViews.bind(workspacePanels.assert("files")).open(LOCAL_FILE_VIEW_ID, { rootId, nodeId, name });
  }
}
