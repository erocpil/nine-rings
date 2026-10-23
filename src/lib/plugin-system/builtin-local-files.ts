import { clearLocalFileSessions } from "../local-files/session";
import { pluginRuntime } from "./runtime";
import { pluginLifecycle } from "./lifecycle";
import { workspacePanels } from "./panel-registry";
import { localFileService } from "../local-files/service";
import { mainViews } from "./main-view-registry";
export const LOCAL_FILE_VIEW_ID = "builtin.local-files";
export const LOCAL_FILES_ID = "nine-rings.builtin-local-files";
const KEY = "nr:pluginLocalFiles";
const CHANGE = "nr:plugin-local-files-change";
export const localFilesSnapshot = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export const localFilesEnabled = () => localFilesSnapshot() === "true";
export function saveLocalFilesEnabled(enabled: boolean) {
  localStorage.setItem(KEY, String(enabled));
  window.dispatchEvent(new Event(CHANGE));
}
export function subscribeLocalFiles(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("storage", storage);
  };
}
export function startBuiltinLocalFiles() {
  let stopped = false;
  let revision = 0;
  let queue = Promise.resolve();
  let enabled = pluginRuntime.isEnabled();
  const reconcile = () => {
    const requested = ++revision;
    queue = queue
      .then(async () => {
        if (stopped || requested !== revision) return;
        await pluginLifecycle.deactivate(LOCAL_FILES_ID);
        if (
          stopped ||
          requested !== revision ||
          !pluginRuntime.isEnabled() ||
          !localFilesEnabled()
        )
          return;
        await pluginLifecycle.activate(
          LOCAL_FILES_ID,
          ["panels.present", "filesystem.files.read", "views.present"],
          {
            activate(owner) {
              mainViews.bind(owner.activation).register({
                id: LOCAL_FILE_VIEW_ID,
                label: "本地源码",
                renderer: "local-file",
              });
              workspacePanels.register(owner.activation, {
                id: "files",
                label: "本地文件",
                icon: "disk",
                renderer: "local-files",
              });
              owner.own(() => {
                localFileService.release();
                clearLocalFileSessions();
              });
            },
          },
        );
      })
      .catch(() => {});
  };
  const runtime = pluginRuntime.subscribe(() => {
    const next = pluginRuntime.isEnabled();
    if (enabled !== next) {
      enabled = next;
      reconcile();
    }
  });
  const preferences = subscribeLocalFiles(reconcile);
  reconcile();
  return () => {
    stopped = true;
    ++revision;
    runtime();
    preferences();
    void pluginLifecycle.deactivate(LOCAL_FILES_ID).catch(() => {});
  };
}
