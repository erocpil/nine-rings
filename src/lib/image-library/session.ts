import type { ImagePage } from "./directory-service";
import type { ViewedImage } from "./viewer-request";
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
