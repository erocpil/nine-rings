import { DEFAULT_HOTKEYS, HOTKEY_LABELS } from "../../types/models";
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
    shortcutReservations: () => {
      let overrides: Record<string, string> = {};
      try { overrides = JSON.parse(localStorage.getItem("nine_rings_config") ?? "{}").hotkeys ?? {}; } catch { /* Keep application defaults when storage is unavailable. */ }
      return Object.entries({ ...DEFAULT_HOTKEYS, ...overrides }).filter(([, shortcut]) => typeof shortcut === "string" && shortcut).map(([id, shortcut]) => ({ shortcut, label: HOTKEY_LABELS[id] ?? id }));
    },
    assertActive: () => pluginRuntime.assert(owner, "filesystem.files.read"),
    roots: () => localFileService.roots(), choose: () => localFileService.choose(),
    addFiles: files => localFileService.addFiles(files),
    displayPath: (rootId, node) => localFileService.displayPath(rootId, node),
    externalOpen: isTauriRuntime() ? { open: (rootId, node, chooseApplication) => localFileService.openExternal(rootId, node, chooseApplication) } : undefined,
    systemProperties: isTauriRuntime() ? async (rootId, node) => (await localFileService.fileProperties(rootId, node, true)).systemShown ?? false : undefined,
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
