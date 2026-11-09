import { MAX_SOURCE_BYTES, type LocalFileSnapshot } from "./file-model";

export function localSourceCopy(source: string, base: Pick<LocalFileSnapshot, "bom" | "lineEnding"> | null): string {
  const normalized = source.replace(/\r\n?/g, "\n");
  const text = base?.lineEnding === "crlf" ? normalized.replace(/\n/g, "\r\n") : base?.lineEnding === "cr" ? normalized.replace(/\n/g, "\r") : normalized;
  const copy = (base?.bom ? "\ufeff" : "") + text;
  if (new TextEncoder().encode(copy).length > MAX_SOURCE_BYTES) throw new Error("另存后文件超过 4 MiB");
  return copy;
}
export function downloadLocalSource(name: string, source: string, base: Pick<LocalFileSnapshot, "bom" | "lineEnding"> | null) {
  const blob = new Blob([localSourceCopy(source, base)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = name;
  try { anchor.click(); } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/** Save through the host's native picker; download when the host requests Web fallback.
 * Cancellation never claims success or changes the original document's dirty state. */
export async function exportLocalSource(
  name: string, source: string, base: Pick<LocalFileSnapshot, "bom" | "lineEnding"> | null,
  saveCopy: (name: string, source: string, base: Pick<LocalFileSnapshot, "bom" | "lineEnding"> | null) => Promise<import("./file-model").SaveAsResult>,
): Promise<boolean> {
  const result = await saveCopy(name, source, base);
  if (result === "cancelled") return false;
  if (result === "unsupported") downloadLocalSource(name, source, base);
  return true;
}
