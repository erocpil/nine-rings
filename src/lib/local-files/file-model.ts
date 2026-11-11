/** Shared file DTOs and relative-path rules; no application or platform state. */
export interface FileRoot {
  id: string;
  name: string;
  transient?: boolean;
}
export interface FileNode {
  id: string;
  name: string;
  directory: boolean;
  size: number;
  modifiedMs?: number;
}
export interface FilePage {
  nodes: FileNode[];
  next: number | null;
}
export interface LocalFileSnapshot {
  source: string;
  revision: string;
  bom: boolean;
  lineEnding: "lf" | "crlf" | "cr" | "mixed";
  modifiedMs: number;
  size: number;
}
export interface LocalFileFingerprint {
  modifiedMs: number;
  size: number;
}
export interface LocalFileDigest extends LocalFileFingerprint { digest: string }
export type SaveAsResult = "saved" | "cancelled" | "unsupported";
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export function fileSegments(path: string): string[] {
  if (!path) return [];
  const parts = path.split("/");
  if (
    parts.some(
      (part) => !part || part === "." || part === ".." || /[\\:\0]/.test(part),
    )
  )
    throw new Error("无效的文件路径");
  return parts;
}

export interface LocalFileDetails extends LocalFileFingerprint {
  path?: string;
  createdMs?: number | null;
  accessedMs?: number | null;
  readonly?: boolean;
  permissions?: string;
  directory?: boolean;
  systemShown?: boolean;
}
