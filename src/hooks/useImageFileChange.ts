import { useSyncExternalStore } from "react";
import {
  imageFileChange,
  subscribeImageFileChanges,
} from "../lib/image-library/file-changes";
import type { ViewedImage } from "../lib/image-library/viewer-request";
export function useImageFileChange(image: ViewedImage) {
  return useSyncExternalStore(subscribeImageFileChanges, () =>
    imageFileChange(image),
  );
}
