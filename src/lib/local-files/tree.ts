import type { FileNode, FilePage } from "./service";

export type LocalFileSort = "name" | "name-desc" | "type";
export interface LocalFileListOptions {
  sort: LocalFileSort;
  showHidden: boolean;
  query: string;
}
export interface ListedFilePage extends FilePage { listingKey: string }
export const localFileListKey = (options: LocalFileListOptions) => JSON.stringify([options.sort, options.showHidden, options.query.trim().toLowerCase()]);
export const appendLocalFileNodes = (previous: readonly FileNode[], next: readonly FileNode[]) => [...new Map([...previous, ...next].map(node => [node.id, node])).values()];
export const DEFAULT_LOCAL_FILE_LIST: LocalFileListOptions = { sort: "name", showHidden: true, query: "" };
const KEY = "nr:local-files-tree-preferences";
export function readLocalFileTreePreferences(): Omit<LocalFileListOptions, "query"> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { sort: value?.sort === "name-desc" || value?.sort === "type" ? value.sort : "name", showHidden: value?.showHidden === true };
  } catch { return { sort: "name", showHidden: false }; }
}
export function saveLocalFileTreePreferences(value: Omit<LocalFileListOptions, "query">) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); }
  catch { /* The tree remains usable without persistence. */ }
}
const extension = (name: string) => { const index = name.lastIndexOf("."); return index > 0 ? name.slice(index + 1).toLowerCase() : ""; };
const compare = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
/** Apply before pagination so matching files beyond the first page remain discoverable. */
export function localFileTreeNodes(nodes: Iterable<FileNode>, options: LocalFileListOptions): FileNode[] {
  const query = options.query.trim().toLowerCase();
  return [...nodes].filter(node => (options.showHidden || !node.name.startsWith(".")) && (node.directory || !query || node.name.toLowerCase().includes(query)))
    .sort((a, b) => Number(b.directory) - Number(a.directory)
      || (options.sort === "type" && !a.directory ? compare(extension(a.name), extension(b.name)) : 0)
      || compare(a.name, b.name) * (options.sort === "name-desc" ? -1 : 1));
}
export function sameLocalFilePage(left: FilePage | undefined, right: FilePage) {
  return left?.next === right.next && left.nodes.length === right.nodes.length
    && left.nodes.every((node, index) => { const other = right.nodes[index]!; return node.id === other.id && node.name === other.name && node.directory === other.directory && node.size === other.size; });
}
/** Descendants of collapsed or hidden folders do not need background enumeration. */
export function isLocalFileDirectoryVisible(key: string, expanded: ReadonlySet<string>, pages: Readonly<Record<string, FilePage>>, rootIds: ReadonlySet<string>, showHidden: boolean) {
    const at = key.indexOf(":"), root = key.slice(0, at), node = key.slice(at + 1);
    if (!rootIds.has(root)) return false;
    const parts = node ? node.split("/") : [];
    if (!showHidden && parts.some(part => part.startsWith("."))) return false;
    return parts.every((_, index) => {
      const parent = `${root}:${parts.slice(0, index).join("/")}`;
      const child = parts.slice(0, index + 1).join("/");
      return expanded.has(parent) && pages[parent]?.nodes.some(item => item.directory && item.id === child);
    });
}
export function visibleLocalFileDirectories(expanded: ReadonlySet<string>, pages: Readonly<Record<string, FilePage>>, rootIds: ReadonlySet<string>, showHidden: boolean) {
  return [...expanded].filter(key => isLocalFileDirectoryVisible(key, expanded, pages, rootIds, showHidden))
    .sort((a, b) => a.split("/").length - b.split("/").length);
}
