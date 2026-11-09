import { localFileService } from "./service";
import { pluginRuntime, type PluginActivation } from "../plugin-system/runtime";
import { mainViews } from "../plugin-system/main-view-registry";
import { FILE_BROWSER_IMAGE_VIEW_ID, FILE_BROWSER_FILE_VIEW_ID } from "../plugin-system/builtin-file-browser";
import { rememberRecentLocalFile } from "./recent";
import { checkpointLocalFile } from "./session";
import { readLocalFocusTabs, saveLocalFocusTabs } from "../focus-tabs";

import { createBrowserDirectoryProvider } from "./browser-provider-core";

/** Nine Rings composition adapter; shared algorithms live in browser-provider-core. */
export function localDirectoryProvider(owner: PluginActivation) {
  const check = (signal: AbortSignal) => { signal.throwIfAborted(); pluginRuntime.assert(owner, "filesystem.files.read"); };
  return createBrowserDirectoryProvider({
    files: localFileService,
    assertActive: () => pluginRuntime.assert(owner, "filesystem.files.read"),
    async open({ rootId, rootName, node, location }, signal) {
      check(signal);
      const current = mainViews.getSnapshot().current;
      if (current?.renderer === "local-file") await checkpointLocalFile(`${current.data.rootId}:${current.data.nodeId}`);
      check(signal);
      if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(node.name)) {
        const src = await localFileService.readImageAsset(rootId, node.id);
        check(signal);
        const image = { src, name: node.name };
        mainViews.bind(owner).open(FILE_BROWSER_IMAGE_VIEW_ID, { image, images: [image] });
      } else {
        const identity = `${rootId}:${node.id}`, tabs = readLocalFocusTabs();
        if (tabs.closed.includes(identity)) saveLocalFocusTabs({ closed: tabs.closed.filter(id => id !== identity), order: [...tabs.order.filter(id => id !== identity), identity] });
        mainViews.bind(owner).open(FILE_BROWSER_FILE_VIEW_ID, { rootId, nodeId: node.id, name: node.name, ...(location ? { location } : {}) });
        rememberRecentLocalFile({ rootId, rootName, nodeId: node.id, name: node.name });
      }
    },
  });
}
