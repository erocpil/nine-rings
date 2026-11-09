import { pluginRuntime } from "../../lib/plugin-system/runtime";
import { workspacePanels } from "../../lib/plugin-system/panel-registry";
import { localFileService } from "../../lib/local-files/service";
import { createBrowserDirectoryProvider } from "../../lib/local-files/browser-provider-core";
import { BrowserOperationQueueCore } from "../../lib/local-files/browser-queue-core";
import { browserSettings } from "../../lib/local-files/browser-settings";
import { searchLocalFiles } from "../../lib/local-files/search";
import type { BrowserFileOpen } from "../../lib/local-files/browser-contract";
import type { BrowserWorkspaceHost } from "../../lib/local-files/browser-workspace-contract";

export const WORKBENCH_ID = "file-workbench.shell";
export const WORKBENCH_SETTINGS_PREFIX = "file-workbench:";
/** Read-only Web prototype. Uses the real service authorization engine, without
 * starting Nine Rings App, builtin plugins, document database or sync services. */
export function createWorkbenchHost(open: (request: BrowserFileOpen) => void) {
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate(WORKBENCH_ID, ["panels.present", "filesystem.files.read"]);
  workspacePanels.register(owner, { id: "browser", label: "文件工作台", icon: "compare", renderer: "file-browser" });
  const assertActive = () => pluginRuntime.assert(owner, "filesystem.files.read");
  const rejectWrite = () => { assertActive(); throw new Error("独立 Web 原型为只读浏览；文件写入尚未开放。"); };
  const queue = new BrowserOperationQueueCore({ assertActive: rejectWrite, execute: rejectWrite });
  const provider = createBrowserDirectoryProvider({
    assertActive, files: localFileService,
    async open(request, signal) { signal.throwIfAborted(); assertActive(); open(request); },
  });
  const workspace: BrowserWorkspaceHost = {
    provider, queue, settings: browserSettings(WORKBENCH_SETTINGS_PREFIX), showQueueHistory: false,
    assertActive, roots: () => localFileService.roots(), choose: () => localFileService.choose(),
    addFiles: files => localFileService.addFiles(files),
    displayPath: (rootId, node) => localFileService.displayPath(rootId, node), absolutePaths: false,
    supportsDirectoryPicker: () => localFileService.supportsDirectoryPicker(),
    supportsDirectoryChanges: rootId => localFileService.supportsDirectoryChanges(rootId),
    canWrite: () => false, canTransfer: () => false, canTrash: () => false,
    search: searchLocalFiles,
    // No writes can originate in this host. External changes use the shared
    // visibility-aware directory refresh; do not subscribe to Nine Rings events.
    subscribeMutations: () => () => {},
  };
  let disposed = false;
  return { workspace, dispose() {
    if (disposed) return;
    disposed = true; queue.dispose(); pluginRuntime.deactivate(WORKBENCH_ID); localFileService.release();
  } };
}
