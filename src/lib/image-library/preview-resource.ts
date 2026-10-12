import { getImageUrl } from "../storage/db-images";
import { readonlyImageSource } from "../readonly-image-source";
import { imageDirectoryService } from "./directory-service";
import type { ViewedImage } from "./viewer-request";
async function makePreview(
  image: ViewedImage,
  signal: AbortSignal,
  maxEdge = 2048,
): Promise<{ url: string; release: () => void }> {
  let url: string;
  let owned = false;
  if (image.rootId && image.nodeId) {
    const blob = await imageDirectoryService.read(image.rootId, image.nodeId);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    // Decode to a bounded preview where supported. Original remains unchanged.
    if (maxEdge > 0 && typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(blob);
      try {
        const canvas = document.createElement("canvas");
        const ratio = Math.min(
          1,
          maxEdge / bitmap.width,
          maxEdge / bitmap.height,
        );
        canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
        canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
        canvas
          .getContext("2d")!
          .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const preview = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value ? resolve(value) : reject(new Error("无法生成预览")),
            "image/png",
          ),
        );
        url = URL.createObjectURL(preview);
      } finally {
        bitmap.close();
      }
    } else url = URL.createObjectURL(blob);
    owned = true;
  } else if (image.src.startsWith("nr-image://")) {
    const resolved = await getImageUrl(image.src);
    if (!resolved) throw new Error("图片资源不存在，请从备份恢复");
    url = resolved;
    owned = true;
  } else {
    url = readonlyImageSource(image.src, document.baseURI);
    if (!url) throw new Error("无效的图片地址");
  }
  if (signal.aborted) {
    if (owned) URL.revokeObjectURL(url);
    throw new DOMException("Cancelled", "AbortError");
  }
  return {
    url,
    release: () => {
      if (owned) URL.revokeObjectURL(url);
    },
  };
}

// Limit thumbnail decode/IO concurrency, and prioritize an explicit viewer request.
let active = 0;
const queue: { run: () => void; signal: AbortSignal; cancel: () => void }[] =
  [];
function pump() {
  while (active < 2 && queue.length) {
    const next = queue.shift()!;
    next.signal.removeEventListener("abort", next.cancel);
    if (next.signal.aborted) {
      next.cancel();
      continue;
    }
    active++;
    next.run();
  }
}
export function imagePreview(
  image: ViewedImage,
  signal: AbortSignal,
  maxEdge = 2048,
): Promise<{ url: string; release: () => void }> {
  return new Promise((resolve, reject) => {
    const job = {
      signal,
      cancel: () => {
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        reject(new DOMException("Cancelled", "AbortError"));
      },
      run: () => {
        void makePreview(image, signal, maxEdge)
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      },
    };
    if (signal.aborted) {
      job.cancel();
      return;
    }
    signal.addEventListener("abort", job.cancel, { once: true });
    if (maxEdge === 128) queue.push(job);
    else queue.unshift(job);
    pump();
  });
}
