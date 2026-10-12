import type { ViewedImage } from "./viewer-request";
/** Derive image choices from the authoritative document, never from visible lazy DOM. */
export function documentImages(content: unknown): ViewedImage[] {
  const images: ViewedImage[] = [];
  const seen = new Set<string>();
  const add = (src: unknown, alt?: unknown, title?: unknown) => {
    if (typeof src !== "string" || !src || seen.has(src)) return;
    seen.add(src);
    images.push({
      src,
      name:
        typeof alt === "string" && alt
          ? alt
          : typeof title === "string" && title
            ? title
            : `图片 ${images.length + 1}`,
    });
  };
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node.type === "resizableImage" || node.type === "markdownImage") {
      const attrs = node.attrs as Record<string, unknown> | undefined;
      add(attrs?.src, attrs?.alt, attrs?.title);
      return;
    }
    if (typeof node.image === "string") add(node.image, node.alt, node.title);
    else if (node.image && typeof node.image === "object") {
      const attrs = node.image as Record<string, unknown>;
      add(attrs.src, attrs.alt, attrs.title);
    }
    if (node.resizableImage && typeof node.resizableImage === "object") {
      const attrs = node.resizableImage as Record<string, unknown>;
      add(attrs.src, attrs.alt, attrs.title);
    }
    for (const [key, child] of Object.entries(node))
      if (key !== "metadata") visit(child);
  };
  visit(content);
  return images;
}
