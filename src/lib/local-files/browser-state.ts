import { fileSegments } from "./file-model";
import { isLocalFileSort, type LocalFileSort } from "./tree";
import type { BrowserMutation } from "./browser-operation-contract";

export interface BrowserLocation {
  rootId: string;
  node: string;
  selected: string[];
  scrollTop: number;
}
export interface BrowserPaneState {
  history: BrowserLocation[];
  index: number;
  sort: LocalFileSort;
  showHidden: boolean;
}
export interface FileBrowserState {
  panes: [BrowserPaneState, BrowserPaneState];
  active: 0 | 1;
  ratio: number;
}
export const FILE_BROWSER_STATE_KEY = "nr:local-file-browser";
const emptyPane = (): BrowserPaneState => ({ history: [], index: -1, sort: "name", showHidden: false });
export const emptyBrowserState = (): FileBrowserState => ({ panes: [emptyPane(), emptyPane()], active: 0, ratio: .5 });
export const browserLocation = (pane: BrowserPaneState) => pane.history[pane.index];

export function reconcileBrowserMutation(state: FileBrowserState, change: BrowserMutation): FileBrowserState {
  return { ...state, panes: state.panes.map(pane => reconcileBrowserPaneMutation(pane, change)) as FileBrowserState["panes"] };
}
export function reconcileBrowserPaneMutation(pane: BrowserPaneState, change: BrowserMutation): BrowserPaneState {
  if (change.kind === "refresh") return pane;
  const matches = (node: string) => node === change.node || node.startsWith(`${change.node}/`);
  const rewrite = (node: string) => `${change.targetNode}${node.slice(change.node.length)}`;
    const history = pane.history.flatMap(entry => {
      if (entry.rootId !== change.rootId) return [entry];
      if (matches(entry.node)) {
        if (change.kind === "trash") return [];
        return [{ ...entry, rootId: change.targetRootId!, node: rewrite(entry.node), selected: entry.selected.map(rewrite) }];
      }
      return [{ ...entry, selected: entry.selected.filter(node => !matches(node)) }];
    });
  const removedBefore = change.kind === "trash" ? pane.history.slice(0, pane.index).filter(entry => entry.rootId === change.rootId && matches(entry.node)).length : 0;
  return { ...pane, history, index: Math.min(pane.index - removedBefore, history.length - 1) };
}

export function navigateBrowserPane(pane: BrowserPaneState, rootId: string, node: string): BrowserPaneState {
  if (!rootId || rootId.length > 4096) throw new Error("无效的目录身份");
  fileSegments(node);
  const current = browserLocation(pane);
  if (current?.rootId === rootId && current.node === node) return pane;
  const history = [...pane.history.slice(0, pane.index + 1), { rootId, node, selected: [], scrollTop: 0 }].slice(-40);
  return { ...pane, history, index: history.length - 1 };
}
export function moveBrowserHistory(pane: BrowserPaneState, direction: -1 | 1): BrowserPaneState {
  if (!pane.history.length) return pane;
  return { ...pane, index: Math.max(0, Math.min(pane.history.length - 1, pane.index + direction)) };
}
export function updateBrowserLocation(pane: BrowserPaneState, patch: Partial<Pick<BrowserLocation, "selected" | "scrollTop">>): BrowserPaneState {
  const location = browserLocation(pane);
  if (!location) return pane;
  return { ...pane, history: pane.history.map((entry, index) => index === pane.index ? { ...entry, ...patch } : entry) };
}
export function selectBrowserItems(current: readonly string[], ids: readonly string[], id: string, anchor: string | null, toggle: boolean, range: boolean): string[] {
  const at = ids.indexOf(id), from = anchor ? ids.indexOf(anchor) : -1;
  if (range && at >= 0 && from >= 0) {
    const selected = ids.slice(Math.min(at, from), Math.max(at, from) + 1);
    return toggle ? [...new Set([...current, ...selected])] : selected;
  }
  return toggle ? current.includes(id) ? current.filter(value => value !== id) : [...current, id] : [id];
}

/** Device-local UI only. Invalid or oversized persisted state cannot become a filesystem path. */
export function parseBrowserState(raw: string | null): FileBrowserState {
  const result = emptyBrowserState();
  try {
    if (!raw || raw.length > 512 * 1024) return result;
    const value = JSON.parse(raw);
    result.active = value.active === 1 ? 1 : 0;
    result.ratio = typeof value.ratio === "number" && Number.isFinite(value.ratio) ? Math.min(.75, Math.max(.25, value.ratio)) : .5;
    result.panes = [0, 1].map(index => {
      const pane = value.panes?.[index];
      const history: BrowserLocation[] = [];
      for (const entry of Array.isArray(pane?.history) ? pane.history.slice(-40) : []) {
        if (!entry || typeof entry.rootId !== "string" || !entry.rootId || entry.rootId.length > 4096 || typeof entry.node !== "string" || entry.node.length > 4096) throw new Error("无效路径");
        fileSegments(entry.node);
        const selected: string[] = Array.isArray(entry.selected) ? entry.selected.filter((id: unknown): id is string => {
          if (typeof id !== "string" || id.length > 4096) return false;
          try { return fileSegments(id).length > 0 && id.split("/").slice(0, -1).join("/") === entry.node; } catch { return false; }
        }).slice(0, 2000) : [];
        history.push({ rootId: entry.rootId, node: entry.node, selected: [...new Set(selected)], scrollTop: typeof entry.scrollTop === "number" && Number.isFinite(entry.scrollTop) ? Math.max(0, entry.scrollTop) : 0 });
      }
      return { history, index: history.length ? Math.max(0, Math.min(history.length - 1, Number.isInteger(pane.index) ? pane.index : history.length - 1)) : -1, sort: isLocalFileSort(pane?.sort) ? pane.sort : "name", showHidden: pane?.showHidden === true };
    }) as FileBrowserState["panes"];
    return result;
  } catch { return emptyBrowserState(); }
}
