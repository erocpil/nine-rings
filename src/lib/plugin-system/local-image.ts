import { api } from "../api";
import { isEncrypted } from "../document-crypto";
import { isPathUnder, normalizeStoragePath } from "../storage/core";
import { storeImage } from "../storage/db-images";
import {
  listProtectedPaths,
  withProtectionWrite,
} from "../storage/protection-state";

export const LOCAL_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
];
export function validateLocalImage(file: Pick<File, "type" | "size">) {
  if (
    !LOCAL_IMAGE_TYPES.includes(file.type) ||
    file.size <= 0 ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error(
      "请选择不超过 10 MB 的 PNG、JPEG、GIF、WebP、AVIF 或 BMP 图片",
    );
}
/** Host-owned resource import. No filesystem path or file handle crosses the SDK. */
export async function storePluginImage(
  file: File,
  documentId: string,
  signal: AbortSignal,
) {
  validateLocalImage(file);
  // Copy picker-backed bytes so the stored resource is independent of the
  // native file and its input element lifetime.
  const blob = new Blob([await file.arrayBuffer()], { type: file.type });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("图片内容无效");
  } catch {
    throw new Error("无法读取这份图片，请检查文件内容和格式");
  } finally {
    URL.revokeObjectURL(url);
  }
  return withProtectionWrite(async () => {
    const note = await api.notes.get(documentId);
    const paths = await listProtectedPaths();
    if (signal.aborted) throw new Error("图片插入已取消");
    if (!note || note.readonly) throw new Error("当前文档不可编辑");
    if (
      isEncrypted(note.content) ||
      paths.some((item) =>
        isPathUnder(
          normalizeStoragePath(note.storagePath || "references"),
          item.path,
        ),
      )
    )
      throw new Error("首期插件不开放受保护文档图片写入");
    return storeImage(blob);
  });
}
