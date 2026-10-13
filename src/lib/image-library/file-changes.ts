import { imageKey } from "./session";
import type { ViewedImage } from "./viewer-request";
export interface ImageFileChange {
  revision: number;
  missing: boolean;
}
const unchanged: ImageFileChange = Object.freeze({
  revision: 0,
  missing: false,
});
const changes = new Map<string, ImageFileChange>();
const listeners = new Set<() => void>();
export const imageFileChange = (image: ViewedImage) =>
  changes.get(imageKey(image)) ?? unchanged;
export const subscribeImageFileChanges = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function reportImageFileChange(image: ViewedImage, missing = false) {
  const previous = imageFileChange(image);
  if (missing && previous.missing) return;
  changes.set(imageKey(image), {
    revision: previous.revision + (missing ? 0 : 1),
    missing,
  });
  for (const listener of listeners) listener();
}
export function resetImageFileChanges() {
  changes.clear();
  for (const listener of listeners) listener();
}
