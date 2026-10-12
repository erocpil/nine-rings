export interface ViewedImage {
  src: string;
  name: string;
  rootId?: string;
  nodeId?: string;
}
export let pendingImageView: {
  image: ViewedImage;
  images: readonly ViewedImage[];
} | null = null;
export function clearImageView() {
  pendingImageView = null;
}
export const IMAGE_VIEW_EVENT = "nr:view-image";
export function requestImageView(
  image: ViewedImage,
  images: readonly ViewedImage[] = [image],
) {
  const detail = { image, images };
  pendingImageView = detail;
  window.dispatchEvent(new CustomEvent(IMAGE_VIEW_EVENT, { detail }));
}

export const IMAGE_INSERT_EVENT = "nr:insert-viewed-image";
