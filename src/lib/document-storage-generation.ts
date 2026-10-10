import { SaveBarrierError } from "./document-save-revisions";

/** Device-local replacement marker, excluded from backup settings. It is not a
 * per-document revision or a cross-device synchronization version. */
export const DOCUMENT_STORAGE_GENERATION_KEY =
  "nr:document-storage-generation:v1";
export function readDocumentStorageGeneration(): string {
  if (typeof window === "undefined") return "headless";
  return localStorage.getItem(DOCUMENT_STORAGE_GENERATION_KEY) ?? "initial";
}
export function advanceDocumentStorageGeneration(generation: string): void {
  if (typeof window !== "undefined")
    localStorage.setItem(DOCUMENT_STORAGE_GENERATION_KEY, generation);
}
export function assertDocumentStorageGeneration(expected: string): void {
  if (readDocumentStorageGeneration() !== expected)
    throw new SaveBarrierError(
      "STALE_REVISION",
      "另一窗口已恢复文档，旧编辑尚未写入；请先检查或导出待保存修改，再载入恢复后的版本",
    );
}
