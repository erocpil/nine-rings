/** Document-level shortcuts, separate from block bookmarks. Only IDs are stored. */
export const DOCUMENT_FAVORITES_KEY = "nr:documentFavorites";

export function readDocumentFavorites(storage: Pick<Storage, "getItem"> = localStorage): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(DOCUMENT_FAVORITES_KEY) ?? "[]");
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id)))]
      : [];
  } catch { return []; }
}

export function toggleDocumentFavorite(id: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): string[] {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("无效的文档标识");
  const current = readDocumentFavorites(storage);
  const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id];
  // Propagate storage errors so the UI never reports an unsaved favorite as saved.
  storage.setItem(DOCUMENT_FAVORITES_KEY, JSON.stringify(next));
  return next;
}

/** Include implied ancestors, including those of retained empty protected paths. */
export function documentFolderPaths(paths: string[]): string[] {
  const result = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/").filter(Boolean);
    segments.forEach((_, index) => result.add(segments.slice(0, index + 1).join("/")));
  }
  return [...result].sort((a, b) => a.localeCompare(b, "zh-CN"));
}
