import { pluginRuntime, type PluginActivation } from "../plugin-system/runtime";
import { isTauriRuntime } from "../runtime";
import { localFileService } from "./service";
import { localDirectoryProvider } from "./browser-provider";
import { getBrowserOperationQueue } from "./browser-operation-queue";
import { FILE_BROWSER_MUTATION_EVENT } from "./browser-operations";
import type { BrowserMutation } from "./browser-operation-contract";
import { browserSettings } from "./browser-settings";
import { searchLocalFiles } from "./search";
import type { BrowserWorkspaceHost } from "./browser-workspace-contract";

export function createNineRingsBrowserHost(owner: PluginActivation): BrowserWorkspaceHost {
  return {
    provider: localDirectoryProvider(owner), queue: getBrowserOperationQueue(owner),
    settings: browserSettings(), showQueueHistory: true,
    assertActive: () => pluginRuntime.assert(owner, "filesystem.files.read"),
    roots: () => localFileService.roots(), choose: () => localFileService.choose(),
    addFiles: files => localFileService.addFiles(files),
    displayPath: (rootId, node) => localFileService.displayPath(rootId, node),
    externalOpen: isTauriRuntime() ? { open: (rootId, node, chooseApplication) => localFileService.openExternal(rootId, node, chooseApplication) } : undefined,
    absolutePaths: isTauriRuntime(),
    supportsDirectoryPicker: () => localFileService.supportsDirectoryPicker(),
    supportsDirectoryChanges: rootId => localFileService.supportsDirectoryChanges(rootId),
    canWrite: rootId => localFileService.supportsDirectoryChanges(rootId),
    canTransfer: () => localFileService.canTransfer(), canTrash: () => localFileService.canTrash(),
    search: searchLocalFiles,
    subscribeMutations(listener) {
      const changed = (event: Event) => listener((event as CustomEvent<BrowserMutation>).detail);
      window.addEventListener(FILE_BROWSER_MUTATION_EVENT, changed);
      return () => window.removeEventListener(FILE_BROWSER_MUTATION_EVENT, changed);
    },
  };
}
