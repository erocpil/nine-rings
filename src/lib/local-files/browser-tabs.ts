import { browserLocation, emptyBrowserState, navigateBrowserPane, parseBrowserState, reconcileBrowserPaneMutation, type BrowserPaneState } from "./browser-state";
import type { BrowserMutation } from "./browser-operations";

export interface BrowserWorkspaceTab extends BrowserPaneState { tabId: string }
export interface BrowserTabGroup { tabs: BrowserWorkspaceTab[]; active: number }
const tabId = () => crypto.randomUUID();
export interface BrowserWorkspaceState { version: 2; groups: [BrowserTabGroup, BrowserTabGroup]; active: 0 | 1; ratio: number }
export const MAX_BROWSER_TABS = 16;
export const activeBrowserPanes = (state: BrowserWorkspaceState): [BrowserPaneState, BrowserPaneState] => [state.groups[0].tabs[state.groups[0].active], state.groups[1].tabs[state.groups[1].active]];
export function parseBrowserWorkspace(raw: string | null): BrowserWorkspaceState {
  const old = parseBrowserState(raw);
  const fallback: BrowserWorkspaceState = { version: 2, groups: old.panes.map(pane => ({ tabs: [{ ...pane, tabId: tabId() }], active: 0 })) as BrowserWorkspaceState["groups"], active: old.active, ratio: old.ratio };
  try {
    if (!raw || raw.length > 512 * 1024) return fallback;
    const value = JSON.parse(raw);
    if (value.version !== 2 || !Array.isArray(value.groups) || value.groups.length !== 2) return fallback;
    const groups = value.groups.map((group: BrowserTabGroup) => {
      if (!group || !Array.isArray(group.tabs) || !group.tabs.length || group.tabs.length > MAX_BROWSER_TABS) throw new Error("无效标签页");
      // Reuse the established bounded path/history parser for each tab. No tab
      // can inject permissions or turn a saved path into an authorization.
      const seen = new Set<string>();
      const tabs = group.tabs.map(tab => {
        const id = typeof tab.tabId === "string" && tab.tabId.length <= 80 && tab.tabId && !seen.has(tab.tabId) ? tab.tabId : tabId(); seen.add(id);
        return { ...parseBrowserState(JSON.stringify({ panes: [tab] })).panes[0], tabId: id };
      });
      return { tabs, active: Number.isInteger(group.active) ? Math.max(0, Math.min(tabs.length - 1, group.active)) : 0 };
    }) as BrowserWorkspaceState["groups"];
    return { version: 2, groups, active: value.active === 1 ? 1 : 0, ratio: typeof value.ratio === "number" && Number.isFinite(value.ratio) ? Math.max(.25, Math.min(.75, value.ratio)) : .5 };
  } catch { return fallback; }
}
export function updateBrowserTab(state: BrowserWorkspaceState, side: 0 | 1, update: (pane: BrowserPaneState) => BrowserPaneState): BrowserWorkspaceState {
  const groups = [...state.groups] as BrowserWorkspaceState["groups"];
  const group = groups[side];
  groups[side] = { ...group, tabs: group.tabs.map((tab, index) => index === group.active ? { ...update(tab), tabId: tab.tabId } : tab) };
  return { ...state, groups };
}
export function addBrowserTab(state: BrowserWorkspaceState, side: 0 | 1): BrowserWorkspaceState {
  const group = state.groups[side];
  if (group.tabs.length >= MAX_BROWSER_TABS) return state;
  const current = group.tabs[group.active], location = browserLocation(current);
  let tab = emptyBrowserState().panes[0];
  if (location) tab = { ...navigateBrowserPane(tab, location.rootId, location.node), sort: current.sort, showHidden: current.showHidden };
  const groups = [...state.groups] as BrowserWorkspaceState["groups"];
  groups[side] = { tabs: [...group.tabs, { ...tab, tabId: tabId() }], active: group.tabs.length };
  return { ...state, active: side, groups };
}
export function selectBrowserTab(state: BrowserWorkspaceState, side: 0 | 1, index: number, close = false): BrowserWorkspaceState {
  const group = state.groups[side];
  if (!Number.isInteger(index) || !group.tabs[index] || (close && group.tabs.length === 1)) return state;
  const groups = [...state.groups] as BrowserWorkspaceState["groups"];
  const tabs = close ? group.tabs.filter((_, at) => at !== index) : group.tabs;
  const active = close ? Math.min(tabs.length - 1, group.active - (index < group.active ? 1 : 0)) : index;
  groups[side] = { tabs, active };
  return { ...state, active: side, groups };
}
export function reconcileBrowserTabs(state: BrowserWorkspaceState, change: BrowserMutation): BrowserWorkspaceState {
  if (change.kind === "refresh") return state;
  return { ...state, groups: state.groups.map(group => ({ ...group, tabs: group.tabs.map(tab => ({ ...reconcileBrowserPaneMutation(tab, change), tabId: tab.tabId })) })) as BrowserWorkspaceState["groups"] };
}
