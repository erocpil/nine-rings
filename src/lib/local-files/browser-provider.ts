import { localFileService, type FileNode } from "./service";
import { pluginRuntime, type PluginActivation } from "../plugin-system/runtime";
import { mainViews } from "../plugin-system/main-view-registry";
import { FILE_BROWSER_IMAGE_VIEW_ID, LOCAL_FILE_VIEW_ID } from "../plugin-system/builtin-local-files";
import { rememberRecentLocalFile } from "./recent";
import { checkpointLocalFile } from "./session";
import type { LocalFileListOptions } from "./tree";
import { readLocalFocusTabs, saveLocalFocusTabs } from "../focus-tabs";

function check(owner: PluginActivation, signal?: AbortSignal) {
  signal?.throwIfAborted();
  pluginRuntime.assert(owner, "filesystem.files.read");
}
/** Shared scoped directory adapter. Cancellation stops acceptance and further reads;
 * native IPC already in progress still settles under its own grant-generation check. */
export function localDirectoryProvider(owner: PluginActivation) {
  return {
    async page(rootId: string, node: string, offset: number, options: LocalFileListOptions, signal: AbortSignal) {
      check(owner, signal);
      const page = await localFileService.list(rootId, node, offset, options);
      check(owner, signal);
      return page;
    },
    async properties(rootId: string, node: string, signal: AbortSignal) {
      check(owner, signal);
      const value = await localFileService.stat(rootId, node);
      check(owner, signal);
      return value;
    },
    async open(rootId: string, rootName: string, node: FileNode, signal: AbortSignal) {
      check(owner, signal);
      const current = mainViews.getSnapshot().current;
      if (current?.renderer === "local-file") await checkpointLocalFile(`${current.data.rootId}:${current.data.nodeId}`);
      check(owner, signal);
      if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(node.name)) {
        const src = await localFileService.readImageAsset(rootId, node.id);
        check(owner, signal);
        const image = { src, name: node.name };
        mainViews.bind(owner).open(FILE_BROWSER_IMAGE_VIEW_ID, { image, images: [image] });
      } else {
        const identity = `${rootId}:${node.id}`, tabs = readLocalFocusTabs();
        if (tabs.closed.includes(identity)) saveLocalFocusTabs({ closed: tabs.closed.filter(id => id !== identity), order: [...tabs.order.filter(id => id !== identity), identity] });
        mainViews.bind(owner).open(LOCAL_FILE_VIEW_ID, { rootId, nodeId: node.id, name: node.name });
        rememberRecentLocalFile({ rootId, rootName, nodeId: node.id, name: node.name });
      }
    },
  };
}
