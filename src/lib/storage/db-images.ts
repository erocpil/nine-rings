// ── db-images.ts：IndexedDB 图片 Blob 存储 ──

import { uuid, now, blobToBase64 } from "./core";
import { withDB } from "./db";

/** 将图片 Blob 存入 IndexedDB，返回 `nr-image://<id>` 引用 */
export async function storeImage(blob: Blob): Promise<string> {
  const id = uuid();
  return withDB(async (db) => {
    const tx = db.transaction("images", "readwrite");
    const store = tx.objectStore("images");
    await new Promise<void>((resolve, reject) => {
      const req = store.put({ id, blob, stored_at: now() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return `nr-image://${id}`;
  });
}

/** 从 IndexedDB 读取图片并创建 Object URL（调用方负责在适当时机 revoke） */
export async function getImageUrl(ref: string): Promise<string | null> {
  const id = ref.replace(/^nr-image:\/\//, "");
  return withDB(async (db) => {
    const tx = db.transaction("images", "readonly");
    const store = tx.objectStore("images");
    const record: any = await new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    if (!record) return null;
    return URL.createObjectURL(record.blob);
  });
}

/** 批量解析 Delta 中的 nr-image:// 引用为 base64（用于导出） */
export async function resolveImageRefs(delta: any): Promise<any> {
  if (!delta?.ops) return delta;

  const resolveImageRef = (insert: unknown): string | null => {
    if (!insert || typeof insert !== "object") return null;

    const directImage = (insert as any).image;
    if (typeof directImage === "string") return directImage;
    if (directImage && typeof directImage === "object" && typeof directImage.src === "string") {
      return directImage.src;
    }

    const directResizableImage = (insert as any).resizableImage;
    if (typeof directResizableImage === "string") return directResizableImage;
    if (directResizableImage && typeof directResizableImage === "object" && typeof directResizableImage.src === "string") {
      return directResizableImage.src;
    }

    return null;
  };

  const replaceImageRef = (insert: unknown, imageRef: string): boolean => {
    if (!insert || typeof insert !== "object") return false;

    const node: any = insert as any;
    if (typeof node.image === "string") {
      node.image = imageRef;
      return true;
    }

    if (node.image && typeof node.image === "object" && "src" in node.image) {
      node.image.src = imageRef;
      return true;
    }

    if (typeof node.resizableImage === "string") {
      node.resizableImage = imageRef;
      return true;
    }

    if (node.resizableImage && typeof node.resizableImage === "object" && "src" in node.resizableImage) {
      node.resizableImage.src = imageRef;
      return true;
    }

    return false;
  };

  return withDB(async (db) => {
    const ops = [...delta.ops];
    const tx = db.transaction("images", "readonly");
    const store = tx.objectStore("images");
    for (const op of ops) {
      const imageRef = resolveImageRef(op.insert);
      if (!imageRef || !imageRef.startsWith("nr-image://")) continue;
      const id = imageRef.replace(/^nr-image:\/\//, "");
      const record: any = await new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
      if (record) {
        const base64 = await blobToBase64(record.blob);
        replaceImageRef(op.insert, base64);
      }
    }
    return { ...delta, ops };
  });
}
