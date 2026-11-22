/** Shared file DTOs and relative-path rules; no application or platform state. */
export interface FileRoot {
  id: string;
  name: string;
  transient?: boolean;
}
export type LocalFileLink = "file" | "missing" | "outside-root" | "directory" | "unsupported";
export const localFileLinkLabel: Record<LocalFileLink, string> = {
  file: "符号链接",
  missing: "符号链接 · 目标不存在",
  "outside-root": "符号链接 · 目标超出授权目录",
  directory: "符号链接 · 目录目标",
  unsupported: "符号链接 · 无法打开",
};
export interface FileNode {
  link?: LocalFileLink;
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

export function resolveRelativeNode(fromNode: string, href: string): string {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(href)) throw new Error("链接不在本地授权目录内");
  const pathname = decodeURIComponent(href.split(/[?#]/, 1)[0] ?? "");
  const parts = fromNode.split("/").slice(0, -1);
  for (const part of pathname.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) throw new Error("相对资源超出授权目录"); parts.pop(); }
    else parts.push(part);
  }
  const result = parts.join("/");
  fileSegments(result);
  return result;
}
