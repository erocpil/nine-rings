/** UTF-8 size of the serialized document body, matching its persisted Delta form. */
export function documentSizeBytes(content: unknown): number {
  const serialized = JSON.stringify(content);
  return new TextEncoder().encode(serialized ?? "").byteLength;
}

export function formatDocumentSize(bytes: number): string {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, Math.round(bytes)) : 0;
  if (safeBytes < 1024) return `${safeBytes} B`;
  if (safeBytes < 1024 * 1024) return `${(safeBytes / 1024).toFixed(1)} KB`;
  return `${(safeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
