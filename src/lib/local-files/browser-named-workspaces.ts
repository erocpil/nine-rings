import { parseBrowserWorkspace, browserSideRows, revokeBrowserRoot, type BrowserWorkspaceState } from "./browser-tabs";
import type { BrowserSettingsStore } from "./browser-workspace-contract";

const KEY = "named-browser-workspaces-v1";
const MAX_LAYOUTS = 12;
const MAX_CHARS = 2 * 1024 * 1024;
export interface NamedBrowserWorkspace { id: string; name: string; layout: BrowserWorkspaceState }

export function readNamedBrowserWorkspaces(store: BrowserSettingsStore): NamedBrowserWorkspace[] {
  const raw = store.getItem(KEY);
  if (!raw) return [];
  if (raw.length > MAX_CHARS) throw new Error("工作区记录超出容量");
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > MAX_LAYOUTS) throw new Error("无法读取已保存的工作区");
  const ids = new Set<string>();
  return data.map(entry => {
    if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id) ||
      typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 80 ||
      entry.layout?.version !== 2 || !Array.isArray(entry.layout.groups) || entry.layout.groups.length !== 2) {
      throw new Error("无法读取已保存的工作区");
    }
    ids.add(entry.id);
    return { id: entry.id, name: entry.name, layout: parseBrowserWorkspace(JSON.stringify(entry.layout)) };
  });
}

export function saveNamedBrowserWorkspaces(store: BrowserSettingsStore, workspaces: NamedBrowserWorkspace[]) {
  if (workspaces.length > MAX_LAYOUTS) throw new Error(`最多保存 ${MAX_LAYOUTS} 个工作区`);
  if (workspaces.some(entry => JSON.stringify(entry.layout).length > 512 * 1024)) throw new Error("当前布局记录过大，请减少标签后重试");
  const value = JSON.stringify(workspaces);
  if (value.length > MAX_CHARS) throw new Error("工作区记录超出容量");
  store.setItem(KEY, value);
}

export function restoreNamedBrowserWorkspace(layout: BrowserWorkspaceState, rootIds: readonly string[]) {
  const known = new Set(rootIds), revoked = new Set<string>();
  for (const side of [0, 1] as const) for (const group of browserSideRows(layout, side)) {
    for (const tab of [...group.tabs, ...(group.closed ?? [])]) {
      for (const entry of tab.history) if (!known.has(entry.rootId)) revoked.add(entry.rootId);
      if (tab.anchor && !known.has(tab.anchor.rootId)) revoked.add(tab.anchor.rootId);
    }
  }
  let result = layout;
  for (const rootId of revoked) result = revokeBrowserRoot(result, rootId, rootIds[0]);
  return result;
}
