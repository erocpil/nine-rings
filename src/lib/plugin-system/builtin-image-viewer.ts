import { resetImageLibrarySession } from "../image-library/session";
import { imageResourceCache } from "../image-library/resource-cache";
import { pluginRuntime } from "./runtime";
import { pluginLifecycle } from "./lifecycle";
import { workspacePanels } from "./panel-registry";
import { imageDirectoryService } from "../image-library/directory-service";
import { imageDirectoryMonitor } from "../image-library/directory-monitor";
import { clearImageView } from "../image-library/viewer-request";
import { mainViews } from "./main-view-registry";
export const IMAGE_VIEW_ID = "builtin.image-viewer";
export const IMAGE_VIEWER_ID = "nine-rings.builtin-image-viewer";
const KEY = "nr:pluginImageViewer";
const CHANGE = "nr:plugin-image-viewer-change";
export const imageViewerSnapshot = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export const imageViewerEnabled = () => imageViewerSnapshot() !== "false";
export function saveImageViewerEnabled(enabled: boolean) {
  localStorage.setItem(KEY, String(enabled));
  window.dispatchEvent(new Event(CHANGE));
}
export function subscribeImageViewer(listener: () => void) {
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
export function startBuiltinImageViewer() {
  let stopped = false;
  let revision = 0;
  let queue = Promise.resolve();
  let enabled = pluginRuntime.isEnabled();
  const reconcile = () => {
    const requested = ++revision;
    queue = queue
      .then(async () => {
        if (stopped || requested !== revision) return;
        await pluginLifecycle.deactivate(IMAGE_VIEWER_ID);
        if (
          stopped ||
          requested !== revision ||
          !pluginRuntime.isEnabled() ||
          !imageViewerEnabled()
        )
          return;
        await pluginLifecycle.activate(
          IMAGE_VIEWER_ID,
          ["panels.present", "filesystem.images.read", "views.present"],
          {
            activate(owner) {
              mainViews.bind(owner.activation).register({
                id: IMAGE_VIEW_ID,
                label: "图片查看",
                renderer: "image",
              });
              workspacePanels.register(owner.activation, {
                id: "images",
                label: "图片",
                icon: "image",
                renderer: "image-library",
              });
              owner.own(() => {
                imageDirectoryMonitor.reset();
                imageResourceCache.clear();
                resetImageLibrarySession();
                clearImageView();
                imageDirectoryService.release();
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
  const preferences = subscribeImageViewer(reconcile);
  reconcile();
  return () => {
    stopped = true;
    ++revision;
    runtime();
    preferences();
    void pluginLifecycle.deactivate(IMAGE_VIEWER_ID).catch(() => {});
  };
}
