import { normalizeStoragePath } from "./storage/core";

/** Renaming changes one path segment, never its parent or nesting. */
export function resolveFolderRename(path: string, name: string): string {
  const source = normalizeStoragePath(path);
  const leaf = name.trim();
  if (!leaf || /[/\\]/.test(leaf)) throw new Error("路径名称不能为空或包含斜杠");
  const parts = source.split("/");
  parts[parts.length - 1] = leaf;
  return normalizeStoragePath(parts.join("/"));
}
