import { browserLocation, emptyBrowserState, navigateBrowserPane, parseBrowserState, reconcileBrowserPaneMutation, type BrowserPaneState } from "./browser-state";
import type { BrowserMutation } from "./browser-operation-contract";

export interface BrowserWorkspaceTab extends BrowserPaneState { tabId: string; pinned?: boolean }
export interface BrowserTabGroup { tabs: BrowserWorkspaceTab[]; active: number; closed?: BrowserWorkspaceTab[] }
const tabId = () => crypto.randomUUID();
export interface BrowserWorkspaceState { version: 2; groups: [BrowserTabGroup, BrowserTabGroup]; active: 0 | 1; ratio: number; extraGroups?: [BrowserTabGroup[], BrowserTabGroup[]]; activeRows?: [number, number]; visibleRows?: [number, number] }
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
        return { ...parseBrowserState(JSON.stringify({ panes: [tab] })).panes[0], tabId: id, pinned: tab.pinned === true };
      });
      const closed = (Array.isArray(group.closed) ? group.closed.slice(-16) : []).map(tab => ({ ...parseBrowserState(JSON.stringify({ panes: [tab] })).panes[0], tabId: tabId() })).filter(tab => browserLocation(tab));
      return { tabs, closed, active: Number.isInteger(group.active) ? Math.max(0, Math.min(tabs.length - 1, group.active)) : 0 };
    }) as BrowserWorkspaceState["groups"];
    const extras = Array.isArray(value.extraGroups) && value.extraGroups.length === 2 ? value.extraGroups.map((items: BrowserTabGroup[]) => (Array.isArray(items) ? items.slice(0, 3) : []).map(group => parseBrowserWorkspace(JSON.stringify({ version: 2, groups: [group, group] })).groups[0])) as [BrowserTabGroup[], BrowserTabGroup[]] : undefined;
    if (extras) for (const side of [0, 1] as const) {
      const seen = new Set(groups[side].tabs.map(tab => tab.tabId));
      extras[side] = extras[side].map(group => ({ ...group, tabs: group.tabs.map(tab => { const id = seen.has(tab.tabId) ? tabId() : tab.tabId; seen.add(id); return { ...tab, tabId: id }; }) }));
    }
    const visibleRows = extras ? extras.map((items, side) => Math.max(1, Math.min(items.length + 1, Number.isInteger(value.visibleRows?.[side]) ? value.visibleRows[side] : 1))) as [number, number] : undefined;
    const activeRows = extras ? extras.map((_, side) => Math.max(0, Math.min(visibleRows![side] - 1, Number.isInteger(value.activeRows?.[side]) ? value.activeRows[side] : 0))) as [number, number] : undefined;
    return { version: 2, groups, ...(extras ? { extraGroups: extras, activeRows, visibleRows } : {}), active: value.active === 1 ? 1 : 0, ratio: typeof value.ratio === "number" && Number.isFinite(value.ratio) ? Math.max(.25, Math.min(.75, value.ratio)) : .5 };
  } catch { return fallback; }
}
export function updateBrowserTab(state: BrowserWorkspaceState, side: 0 | 1, update: (pane: BrowserPaneState) => BrowserPaneState): BrowserWorkspaceState {
  const groups = [...state.groups] as BrowserWorkspaceState["groups"];
  const group = groups[side];
  groups[side] = { ...group, tabs: group.tabs.map((tab, index) => index === group.active ? { ...update(tab), tabId: tab.tabId, pinned: tab.pinned } : tab) };
  return { ...state, groups };
}
export function addBrowserTab(state: BrowserWorkspaceState, side: 0 | 1): BrowserWorkspaceState {
  const group = state.groups[side];
  if (group.tabs.length >= MAX_BROWSER_TABS) return state;
  const current = group.tabs[group.active], location = browserLocation(current);
  let tab = emptyBrowserState().panes[0];
  if (location) tab = { ...navigateBrowserPane(tab, location.rootId, location.node), sort: current.sort, showHidden: current.showHidden };
  const groups = [...state.groups] as BrowserWorkspaceState["groups"];
  groups[side] = { ...group, tabs: [...group.tabs, { ...tab, tabId: tabId() }], active: group.tabs.length };
  return { ...state, active: side, groups };
}
export function selectBrowserTab(state: BrowserWorkspaceState, side: 0 | 1, index: number, close = false, confirmedPinned = false): BrowserWorkspaceState {
  const group = state.groups[side];
  if (!Number.isInteger(index) || !group.tabs[index] || (close && !confirmedPinned && (group.tabs.length === 1 || group.tabs[index].pinned))) return state;
  const groups = [...state.groups] as BrowserWorkspaceState["groups"];
  const remaining = close ? group.tabs.filter((_, at) => at !== index) : group.tabs;
  const tabs = remaining.length ? remaining : [{ ...emptyBrowserState().panes[0], tabId: tabId() }];
  const active = close ? Math.min(tabs.length - 1, group.active - (index < group.active ? 1 : 0)) : index;
  groups[side] = { ...group, tabs, active, ...(close ? { closed: [...(group.closed ?? []), group.tabs[index]].slice(-16) } : {}) };
  return { ...state, active: side, groups };
}
export function reconcileBrowserTabs(state: BrowserWorkspaceState, change: BrowserMutation): BrowserWorkspaceState {
  if (change.kind === "refresh") return state;
  const reconcile = (tab: BrowserWorkspaceTab) => ({ ...tab, ...reconcileBrowserPaneMutation(tab, change) });
  const apply = (group: BrowserTabGroup) => ({ ...group, tabs: group.tabs.map(reconcile), closed: group.closed?.map(reconcile).filter(tab => browserLocation(tab)) });
  return { ...state, groups: state.groups.map(apply) as BrowserWorkspaceState["groups"], ...(state.extraGroups ? { extraGroups: state.extraGroups.map(groups => groups.map(apply)) as [BrowserTabGroup[], BrowserTabGroup[]] } : {}) };
}

/** All advanced tab actions address stable IDs, never a stale context-menu index. */
export function modifyBrowserTabs(state: BrowserWorkspaceState, side: 0 | 1, id: string, action: "pin" | "others" | "right" | "restore" | "left" | "next", confirmedPinned = false): BrowserWorkspaceState {
  const group = state.groups[side], index = group.tabs.findIndex(tab => tab.tabId === id);
  if (index < 0) return state;
  let tabs = [...group.tabs], closed = [...(group.closed ?? [])];
  const activeId = tabs[group.active].tabId;
  if (action === "pin") tabs[index] = { ...tabs[index], pinned: !tabs[index].pinned };
  else if (action === "restore") {
    if (!closed.length || tabs.length >= MAX_BROWSER_TABS) return state;
    tabs.push({ ...closed.pop()!, tabId: tabId(), pinned: false });
  } else if (action === "left" || action === "next") return reorderBrowserTab(state, side, id, tabs[index + (action === "left" ? -1 : 1)]?.tabId);
  else {
    const removed = tabs.filter((tab, at) => (confirmedPinned || !tab.pinned) && at !== index && (action === "others" || at > index));
    closed = [...closed, ...removed].slice(-16);
    tabs = tabs.filter(tab => !removed.includes(tab));
  }
  const active = action === "restore" ? tabs.length - 1 : Math.max(0, tabs.findIndex(tab => tab.tabId === activeId));
  const groups = [...state.groups] as BrowserWorkspaceState["groups"];
  groups[side] = { tabs, closed, active: tabs.some(tab => tab.tabId === activeId) || action === "restore" ? active : tabs.findIndex(tab => tab.tabId === id) };
  return { ...state, groups, active: side };
}
export function reorderBrowserTab(state: BrowserWorkspaceState, side: 0 | 1, id: string, targetId?: string): BrowserWorkspaceState {
  const group = state.groups[side], from = group.tabs.findIndex(tab => tab.tabId === id), to = group.tabs.findIndex(tab => tab.tabId === targetId);
  if (from < 0 || to < 0 || from === to) return state;
  const tabs = [...group.tabs], activeId = tabs[group.active].tabId;
  tabs.splice(to, 0, ...tabs.splice(from, 1));
  const groups = [...state.groups] as BrowserWorkspaceState["groups"];
  groups[side] = { ...group, tabs, active: tabs.findIndex(tab => tab.tabId === activeId) };
  return { ...state, groups };
}
/** Move entire groups, retaining every tab's identity and state. */
export function exchangeBrowserPanes(state: BrowserWorkspaceState): BrowserWorkspaceState {
  return { ...state, ...(state.extraGroups ? { extraGroups: [state.extraGroups[1], state.extraGroups[0]] as [BrowserTabGroup[], BrowserTabGroup[]], activeRows: [state.activeRows?.[1] ?? 0, state.activeRows?.[0] ?? 0] as [number, number], visibleRows: [state.visibleRows?.[1] ?? 1, state.visibleRows?.[0] ?? 1] as [number, number] } : {}), groups: [state.groups[1], state.groups[0]], active: state.active === 0 ? 1 : 0 };
}
/** Only navigate the opposite active tab; its other tabs remain untouched. */
export function mirrorBrowserPath(state: BrowserWorkspaceState): BrowserWorkspaceState {
  const source = browserLocation(activeBrowserPanes(state)[state.active]);
  if (!source) return state;
  return updateBrowserTab(state, state.active === 0 ? 1 : 0, pane => navigateBrowserPane(pane, source.rootId, source.node));
}


/** groups always contains each side's active row, so the existing operation,
 * preview and tab reducers keep one authoritative source/target pair. */
export function browserSideRows(state: BrowserWorkspaceState, side: 0 | 1) {
  const rows = [...(state.extraGroups?.[side] ?? [])];
  rows.splice(state.activeRows?.[side] ?? 0, 0, state.groups[side]);
  return rows;
}
export function activateBrowserRow(state: BrowserWorkspaceState, side: 0 | 1, row: number): BrowserWorkspaceState {
  if (!state.extraGroups && row === 0) return { ...state, active: side };
  const rows = browserSideRows(state, side);
  if (!rows[row]) return state;
  const groups = [...state.groups] as BrowserWorkspaceState["groups"], extraGroups = [...(state.extraGroups ?? [[], []])] as [BrowserTabGroup[], BrowserTabGroup[]], activeRows = [...(state.activeRows ?? [0, 0])] as [number, number];
  groups[side] = rows[row]; extraGroups[side] = rows.filter((_, at) => at !== row); activeRows[side] = row;
  return { ...state, groups, extraGroups, activeRows, active: side };
}
export function updateBrowserRow(state: BrowserWorkspaceState, side: 0 | 1, row: number, update: (pane: BrowserPaneState) => BrowserPaneState): BrowserWorkspaceState {
  if (!browserSideRows(state, side)[row]) return state;
  if (row === (state.activeRows?.[side] ?? 0)) return updateBrowserTab(state, side, update);
  const changed = updateBrowserTab(activateBrowserRow(state, side, row), side, update);
  return { ...activateBrowserRow(changed, side, state.activeRows?.[side] ?? 0), active: state.active };
}
export function setBrowserRowCount(state: BrowserWorkspaceState, side: 0 | 1, count: number): BrowserWorkspaceState {
  if (!Number.isInteger(count) || count < 1 || count > 4) return state;
  let next = state;
  const rows = browserSideRows(next, side);
  while (rows.length < count) {
    const current = rows[rows.length - 1].tabs[rows[rows.length - 1].active];
    rows.push({ tabs: [{ ...current, history: current.history.map(entry => ({ ...entry, selected: [], scrollTop: 0 })), tabId: tabId(), pinned: false }], active: 0 });
  }
  const activeRow = Math.min(state.activeRows?.[side] ?? 0, count - 1);
  const groups = [...next.groups] as BrowserWorkspaceState["groups"], extraGroups = [...(next.extraGroups ?? [[], []])] as [BrowserTabGroup[], BrowserTabGroup[]], activeRows = [...(next.activeRows ?? [0, 0])] as [number, number], visibleRows = [...(next.visibleRows ?? [1, 1])] as [number, number];
  groups[side] = rows[activeRow]; extraGroups[side] = rows.filter((_, at) => at !== activeRow); activeRows[side] = activeRow; visibleRows[side] = count;
  next = { ...next, groups, extraGroups, activeRows, visibleRows };
  return next;
}

/** Root identity, not path prefixes: independent parent/child grants remain usable. */
export function revokeBrowserRoot(state: BrowserWorkspaceState, rootId: string, fallbackRootId?: string): BrowserWorkspaceState {
  const clean = (tab: BrowserWorkspaceTab): BrowserWorkspaceTab => {
    const history = tab.history.filter(entry => entry.rootId !== rootId);
    const before = tab.history.slice(0, tab.index).filter(entry => entry.rootId === rootId).length;
    const next = { ...tab, history, index: Math.min(tab.index - before, history.length - 1) };
    return history.length || !fallbackRootId ? next : { ...navigateBrowserPane(next, fallbackRootId, ""), tabId: tab.tabId, pinned: tab.pinned };
  };
  const apply = (group: BrowserTabGroup) => ({ ...group, tabs: group.tabs.map(clean), closed: group.closed?.filter(tab => tab.history.some(entry => entry.rootId !== rootId)).map(clean) });
  return { ...state, groups: state.groups.map(apply) as BrowserWorkspaceState["groups"], ...(state.extraGroups ? { extraGroups: state.extraGroups.map(groups => groups.map(apply)) as [BrowserTabGroup[], BrowserTabGroup[]] } : {}) };
}
