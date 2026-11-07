import { pluginRuntime } from "./runtime";
import { pluginLifecycle } from "./lifecycle";
import { workspacePanels } from "./panel-registry";
import { mainViews } from "./main-view-registry";
import { retainLocalFileResources } from "./local-file-resources";

export const FILE_BROWSER_ID = "nine-rings.builtin-file-browser";
export const FILE_BROWSER_VIEW_ID = "builtin.file-browser";
export const FILE_BROWSER_IMAGE_VIEW_ID = "builtin.file-browser-image";
export const FILE_BROWSER_FILE_VIEW_ID = "builtin.file-browser-file";
const KEY = "nr:pluginFileBrowser";
const EVENT = "nr:plugin-file-browser-change";
export function fileBrowserSnapshot() { try { return localStorage.getItem(KEY); } catch { return null; } }
// Preserve the existing entry for users who enabled local files before the split.
export function fileBrowserEnabled() { try { const value = fileBrowserSnapshot(); return value === "true" || (value === null && localStorage.getItem("nr:pluginLocalFiles") === "true"); } catch { return false; } }
export function saveFileBrowserEnabled(enabled: boolean) { localStorage.setItem(KEY, String(enabled)); window.dispatchEvent(new Event(EVENT)); }
export function subscribeFileBrowser(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener(); };
  window.addEventListener(EVENT, listener); window.addEventListener("storage", storage);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener("storage", storage); };
}
export function openFileBrowser() { return mainViews.bind(workspacePanels.assert("browser")).open(FILE_BROWSER_VIEW_ID, {}); }
export function startBuiltinFileBrowser() {
  let stopped = false, revision = 0;
  let queue = Promise.resolve();
  let enabled = pluginRuntime.isEnabled();
  // One-time migration; later toggling local files must not toggle this plugin.
  try { if (fileBrowserSnapshot() === null) localStorage.setItem(KEY, String(fileBrowserEnabled())); } catch { /* storage errors remain visible when explicitly saving */ }
  const reconcile = () => {
    const requested = ++revision;
    queue = queue.then(async () => {
      if (stopped || requested !== revision) return;
      await pluginLifecycle.deactivate(FILE_BROWSER_ID);
      if (stopped || requested !== revision || !pluginRuntime.isEnabled() || !fileBrowserEnabled()) return;
      await pluginLifecycle.activate(FILE_BROWSER_ID, ["panels.present", "filesystem.files.read", "filesystem.files.write", "views.present"], {
        activate(owner) {
          owner.own(retainLocalFileResources());
          const views = mainViews.bind(owner.activation);
          views.register({ id: FILE_BROWSER_VIEW_ID, label: "双栏文件浏览", renderer: "file-browser" });
          views.register({ id: FILE_BROWSER_IMAGE_VIEW_ID, label: "本地图片", renderer: "image" });
          views.register({ id: FILE_BROWSER_FILE_VIEW_ID, label: "本地文件", renderer: "local-file" });
          workspacePanels.register(owner.activation, { id: "browser", label: "双栏浏览", icon: "compare", renderer: "file-browser" });
        },
      });
    }).catch(() => {});
  };
  const runtime = pluginRuntime.subscribe(() => { const next = pluginRuntime.isEnabled(); if (next !== enabled) { enabled = next; reconcile(); } });
  const preferences = subscribeFileBrowser(reconcile);
  reconcile();
  return () => { stopped = true; ++revision; runtime(); preferences(); void pluginLifecycle.deactivate(FILE_BROWSER_ID).catch(() => {}); };
}
