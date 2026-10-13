import type { ImagePage } from "./directory-service";
import type { ViewedImage } from "./viewer-request";
const TREE_KEY = "nr:imageTreeExpanded:v1";
function restoredPaths(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(TREE_KEY) ?? "[]");
    return new Set(
      Array.isArray(value)
        ? value.filter((key): key is string => typeof key === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}
const expanded = restoredPaths();
export function imageDirectoryExpanded(key: string): boolean {
  return expanded.has(key);
}
export function saveImageDirectoryExpanded(key: string, open: boolean) {
  if (open) expanded.add(key);
  else expanded.delete(key);
  try {
    localStorage.setItem(TREE_KEY, JSON.stringify([...expanded]));
  } catch {
    /* best effort */
  }
}
/** Device-session UI state survives panel switching; stopping the plugin releases it. */
export const imageLibrarySession = {
  directories: new Map<string, { open: boolean; page: ImagePage | null }>(),
  scrollTop: 0,
};
let selected: Readonly<ViewedImage> | null = null;
const listeners = new Set<() => void>();
export const imageKey = (image: ViewedImage | null) =>
  image
    ? JSON.stringify([image.rootId ?? "", image.nodeId ?? "", image.src])
    : "";
export const selectedImageSnapshot = () => selected;
export function subscribeSelectedImage(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function selectImage(image: ViewedImage | null) {
  if (imageKey(image) === imageKey(selected)) return;
  selected = image ? Object.freeze({ ...image }) : null;
  for (const listener of listeners) listener();
}
export function resetImageLibrarySession() {
  imageLibrarySession.directories.clear();
  imageLibrarySession.scrollTop = 0;
  selectImage(null);
}
