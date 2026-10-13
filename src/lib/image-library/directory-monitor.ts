import {
  imageDirectoryService,
  type ImagePage,
  type ImageNode,
} from "./directory-service";
import { imageLibrarySession, selectedImageSnapshot } from "./session";
import { imageResourceCache } from "./resource-cache";
import {
  reportImageFileChange,
  imageFileChange,
  resetImageFileChanges,
} from "./file-changes";
import type { ViewedImage } from "./viewer-request";

type Observer = {
  active: boolean;
  changed: (page: ImagePage) => void;
  error: (error: unknown) => void;
  ready?: () => void;
};
interface Entry {
  rootId: string;
  path: string;
  observers: Set<Observer>;
  native: boolean;
  stop?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  busy: boolean;
  again: boolean;
  selectedStamp?: { id: string; size: number; modified?: number };
}
const entries = new Map<string, Entry>();
let interval: ReturnType<typeof setInterval> | undefined;
const keyOf = (rootId: string, path: string) => `${rootId}:${path}`;
const target = (rootId: string, node: ImageNode): ViewedImage => ({
  src: "",
  name: node.name,
  rootId,
  nodeId: node.id,
});
const same = (a: ImageNode, b: ImageNode) =>
  a.size === b.size &&
  a.modified === b.modified &&
  a.directory === b.directory &&
  a.name === b.name;

async function refresh(entry: Entry) {
  const key = keyOf(entry.rootId, entry.path);
  if (entries.get(key) !== entry) return;
  if (entry.busy) {
    entry.again = true;
    return;
  }
  entry.busy = true;
  try {
    const before = imageLibrarySession.directories.get(key)?.page;
    // Keep the already loaded range; do not shrink back to the first 200 items.
    const wanted = Math.max(200, before?.nodes.length ?? 0);
    let page = await imageDirectoryService.list(
      entry.rootId,
      entry.path,
      0,
      false,
    );
    while (page.next !== null && page.nodes.length < wanted) {
      const next = await imageDirectoryService.list(
        entry.rootId,
        entry.path,
        page.next,
        false,
      );
      page = { nodes: [...page.nodes, ...next.nodes], next: next.next };
    }
    if (entries.get(key) !== entry) return;
    const previous = new Map(
      before?.nodes.map((node) => [node.id, node]) ?? [],
    );
    const current = new Map(page.nodes.map((node) => [node.id, node]));
    for (const node of page.nodes) {
      if (node.directory) continue;
      const image = target(entry.rootId, node);
      const old = previous.get(node.id);
      if ((old && !same(old, node)) || imageFileChange(image).missing) {
        imageResourceCache.invalidate(image);
        reportImageFileChange(image);
      }
    }
    for (const node of before?.nodes ?? []) {
      if (node.directory || current.has(node.id)) continue;
      const image = target(entry.rootId, node);
      // New entries can move a file beyond the loaded page boundary. Verify
      // absence before declaring deletion, rather than interpreting paging as removal.
      try {
        const info = await imageDirectoryService.stat(entry.rootId, node.id);
        if (entries.get(key) !== entry) return;
        if (
          selectedImageSnapshot()?.rootId === entry.rootId &&
          selectedImageSnapshot()?.nodeId === node.id
        )
          entry.selectedStamp = { id: node.id, ...info };
        if (info.size !== node.size || info.modified !== node.modified) {
          imageResourceCache.invalidate(image);
          reportImageFileChange(image);
        }
      } catch {
        if (entries.get(key) !== entry) return;
        imageResourceCache.invalidate(image);
        reportImageFileChange(image, true);
      }
    }
    const selected = selectedImageSnapshot();
    const selectedNode = selected?.nodeId
      ? current.get(selected.nodeId)
      : undefined;
    if (selected?.rootId === entry.rootId && selectedNode)
      entry.selectedStamp = {
        id: selectedNode.id,
        size: selectedNode.size,
        modified: selectedNode.modified,
      };
    if (
      selected?.rootId === entry.rootId &&
      selected.nodeId &&
      selected.nodeId.split("/").slice(0, -1).join("/") === entry.path &&
      !current.has(selected.nodeId)
    ) {
      try {
        const info = await imageDirectoryService.stat(
          entry.rootId,
          selected.nodeId,
        );
        if (entries.get(key) !== entry) return;
        const previousStamp = entry.selectedStamp;
        entry.selectedStamp = { id: selected.nodeId, ...info };
        if (
          imageFileChange(selected).missing ||
          (previousStamp?.id === selected.nodeId &&
            (previousStamp.size !== info.size ||
              previousStamp.modified !== info.modified))
        ) {
          imageResourceCache.invalidate(selected);
          reportImageFileChange(selected);
        }
      } catch {
        if (entries.get(key) === entry) reportImageFileChange(selected, true);
      }
    }
    if (entries.get(key) !== entry) return;
    for (const observer of entry.observers) observer.ready?.();
    if (JSON.stringify(before) !== JSON.stringify(page)) {
      const session = imageLibrarySession.directories.get(key);
      if (session) session.page = page;
      else imageLibrarySession.directories.set(key, { open: true, page });
      for (const observer of entry.observers) observer.changed(page);
    }
  } catch (error) {
    if (entries.get(key) !== entry) return;
    // A removed watched directory may never notify again after recreation.
    entry.stop?.();
    entry.stop = undefined;
    entry.native = false;
    const selected = selectedImageSnapshot();
    if (
      selected?.rootId === entry.rootId &&
      selected.nodeId?.split("/").slice(0, -1).join("/") === entry.path
    ) {
      try {
        await imageDirectoryService.stat(entry.rootId, selected.nodeId);
      } catch {
        if (entries.get(key) === entry) reportImageFileChange(selected, true);
      }
    }
    for (const observer of entry.observers) observer.error(error);
  } finally {
    entry.busy = false;
    if (entry.again) {
      entry.again = false;
      schedule(entry);
    }
  }
}
function schedule(entry: Entry) {
  if (entry.timer) return;
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    void refresh(entry);
  }, 250);
}
function visible() {
  return document.visibilityState !== "hidden";
}
function checkVisible() {
  if (!visible()) return;
  for (const entry of entries.values())
    if ([...entry.observers].some((observer) => observer.active))
      schedule(entry);
}
function polling() {
  if (!visible()) return;
  for (const entry of entries.values()) {
    if (
      !entry.native &&
      [...entry.observers].some((observer) => observer.active)
    )
      schedule(entry);
  }
}
function pageHide(event: PageTransitionEvent) {
  if (!event.persisted) imageDirectoryMonitor.clear();
}
function start() {
  if (interval) return;
  interval = setInterval(polling, 10000);
  window.addEventListener("focus", checkVisible);
  window.addEventListener("pagehide", pageHide);
  document.addEventListener("visibilitychange", checkVisible);
}
function stop(entry: Entry) {
  clearTimeout(entry.timer);
  entry.stop?.();
}
export const imageDirectoryMonitor = {
  subscribe(rootId: string, path: string, observer: Observer) {
    const key = keyOf(rootId, path);
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        rootId,
        path,
        observers: new Set(),
        native: false,
        busy: false,
        again: false,
      };
      entries.set(key, entry);
      const created = entry;
      void imageDirectoryService
        .watch(rootId, path, () => schedule(created))
        .then((dispose) => {
          if (entries.get(key) !== created) {
            dispose?.();
            return;
          }
          created.stop = dispose ?? undefined;
          created.native = Boolean(dispose);
        })
        .catch((error) => {
          if (entries.get(key) !== created) return;
          console.warn(
            "[ImageLibrary] 目录监听不可用，使用可见期间定期检查",
            error,
          );
        });
    }
    entry.observers.add(observer);
    start();
    if (observer.active) schedule(entry);
    return () => {
      entry.observers.delete(observer);
      if (!entry.observers.size && entries.get(key) === entry) {
        entries.delete(key);
        stop(entry);
      }
      if (!entries.size) this.clear();
    };
  },
  clear() {
    for (const entry of entries.values()) stop(entry);
    entries.clear();
    clearInterval(interval);
    interval = undefined;
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", checkVisible);
      window.removeEventListener("pagehide", pageHide);
    }
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", checkVisible);
  },
  reset() {
    this.clear();
    resetImageFileChanges();
  },
};
