/** 返回文档相对于当前目录的子路径；当前目录直属文档用 `.` 表示。 */
export function relativeDocumentSubpath(storagePath: string | undefined, rootPath: string): string {
  const root = rootPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const path = (storagePath ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!path) return ".";
  if (!root) return path;
  if (path === root) return ".";
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}
