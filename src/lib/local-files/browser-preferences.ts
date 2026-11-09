import { fileSegments } from "./file-model";
export interface BrowserColumns { name: number; size: number; modified: number; autoName: boolean }
export const DEFAULT_BROWSER_COLUMNS: BrowserColumns = { name: 110, size: 72, modified: 145, autoName: true };
export type BrowserColumn = "name" | "size" | "modified";
export function clampBrowserColumn(column: BrowserColumn, width: number) { const min = { name: 110, size: 56, modified: 100 }[column]; return Number.isFinite(width) ? Math.round(Math.max(min, Math.min(column === "name" ? 1000 : 400, width))) : DEFAULT_BROWSER_COLUMNS[column]; }
export function parseBrowserColumns(raw: string | null): BrowserColumns {
  try { const value = JSON.parse(raw ?? "{}"); return { name: clampBrowserColumn("name", value.name), size: clampBrowserColumn("size", value.size), modified: clampBrowserColumn("modified", value.modified), autoName: value.autoName !== false }; }
  catch { return { ...DEFAULT_BROWSER_COLUMNS }; }
}
export const BROWSER_FAVORITES_KEY = "nr:file-browser-favorites";
export const BROWSER_FAVORITES_EVENT = "nr:file-browser-favorites-change";
export interface BrowserFavorite { rootId: string; node: string }
export function parseBrowserFavorites(raw: string | null): BrowserFavorite[] {
  try {
    if (!raw || raw.length > 256 * 1024) return [];
    const value = JSON.parse(raw); if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.slice(0, 40).flatMap(item => {
      if (!item || typeof item.rootId !== "string" || !item.rootId || item.rootId.length > 4096 || typeof item.node !== "string" || item.node.length > 4096) return [];
      try { fileSegments(item.node); } catch { return []; }
      const key = `${item.rootId}:${item.node}`; if (seen.has(key)) return []; seen.add(key); return [{ rootId: item.rootId, node: item.node }];
    });
  } catch { return []; }
}
export function readBrowserFavorites() { try { return parseBrowserFavorites(localStorage.getItem(BROWSER_FAVORITES_KEY)); } catch { return []; } }
export function saveBrowserFavorites(values: BrowserFavorite[]) {
  if (values.length > 40) throw new Error("常用目录最多 40 项，请先移除不再使用的目录");
  localStorage.setItem(BROWSER_FAVORITES_KEY, JSON.stringify(values)); window.dispatchEvent(new Event(BROWSER_FAVORITES_EVENT));
}
export function browserFullPath(parent: string, name: string) {
  return `${parent.replace(/[\\/]+$/, "")}${parent.includes("\\") ? "\\" : "/"}${name}`;
}
/** Resolve pasted paths only against host-provided authorized root paths. The
 * resulting relative node is still checked by the existing directory service. */
export function resolveBrowserDirectoryInput(value: string, currentRootId: string, roots: Array<{ id: string; path: string }>) {
  const input = value.trim().replace(/\\/g, "/");
  if (input.startsWith("~/")) throw new Error("请使用完整路径或授权根内相对路径，不展开 ~");
  const absolute = input.startsWith("/") || /^[a-z]:\//i.test(input);
  if (!absolute) { const node = input.replace(/\/+$/, ""); fileSegments(node); return { rootId: currentRootId, node }; }
  const path = input.replace(/\/+$/, "") || "/";
  const windows = /^[a-z]:(?:\/|$)/i.test(path) || path.startsWith("//");
  const fold = (value: string) => windows ? value.toLowerCase() : value;
  for (const root of [...roots].sort((a, b) => b.path.length - a.path.length)) {
    const base = root.path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
    if (fold(path) !== fold(base) && !(base === "/" ? path.startsWith("/") && !windows : fold(path).startsWith(`${fold(base)}/`))) continue;
    const node = path === base || fold(path) === fold(base) ? "" : path.slice(base === "/" ? 1 : base.length + 1);
    fileSegments(node); return { rootId: root.id, node };
  }
  throw new Error("路径不在已授权目录内，请先明确授权对应目录");
}
