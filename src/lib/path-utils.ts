/** basename-style final path component, accepting both POSIX and Windows separators. */
export function pathBaseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const trimmed = normalized.replace(/\/+$/, "");
  if (!trimmed) return normalized.startsWith("/") ? "/" : ".";
  if (/^[A-Za-z]:$/.test(trimmed) && normalized.endsWith("/"))
    return `${trimmed}/`;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** dirname-style parent path, returning `.` when the input has no parent. */
export function pathDirName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const trimmed = normalized.replace(/\/+$/, "");
  if (!trimmed) return normalized.startsWith("/") ? "/" : ".";
  if (/^[A-Za-z]:$/.test(trimmed) && normalized.endsWith("/"))
    return `${trimmed}/`;
  const separator = trimmed.lastIndexOf("/");
  if (separator < 0) return ".";
  if (separator === 0) return "/";
  if (separator === 2 && /^[A-Za-z]:/.test(trimmed)) return trimmed.slice(0, 3);
  return trimmed.slice(0, separator);
}

export function joinDisplayPath(parent: string, name: string): string {
  return parent && parent !== "." ? `${parent.replace(/[\\/]+$/, "")}/${name}` : name;
}
