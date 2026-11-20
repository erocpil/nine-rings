import type { BrowserSettingsStore } from "./browser-workspace-contract";
import { browserLocation } from "./browser-state";
import type { BrowserWorkspaceState } from "./browser-tabs";
export const BROWSER_TAB_DIAGNOSTICS_KEY = "directory-tab-events";
/** Bounded UI lifecycle evidence; never store paths, filenames or file content. */
export function recordBrowserTabEvent(store: BrowserSettingsStore, cause: string, state: BrowserWorkspaceState) {
  try {
    const parsed: unknown = JSON.parse(store.getItem(BROWSER_TAB_DIAGNOSTICS_KEY) ?? "[]");
    const events = Array.isArray(parsed) ? parsed.slice(-39) : [];
    events.push({ at: new Date().toISOString(), cause, counts: state.groups.map(group => group.tabs.length), active: state.active });
    store.setItem(BROWSER_TAB_DIAGNOSTICS_KEY, JSON.stringify(events));
  } catch { /* Observability must never prevent directory browsing. */ }
}


/** Repair the most recent proven legacy reveal. Manual tabs lack the reveal
 * event, and an edited, pinned or navigated copy retains its history. */
export function repairLegacyRevealDuplicate(store: BrowserSettingsStore, state: BrowserWorkspaceState): BrowserWorkspaceState {
  try {
    const raw: unknown = JSON.parse(store.getItem(BROWSER_TAB_DIAGNOSTICS_KEY) ?? "[]");
    if (!Array.isArray(raw)) return state;
    const counts = state.groups.map(group => group.tabs.length);
    const sameCounts = (value: unknown) => Array.isArray(value) && value.length === 2 && value.every((count, index) => count === counts[index]);
    let index = raw.length - 1;
    while (raw[index]?.cause === "restore" && sameCounts(raw[index].counts)) index--;
    const reveal = raw[index], previous = raw[index - 1];
    const side = reveal?.active;
    if (reveal?.cause !== "reveal-file" || (side !== 0 && side !== 1) || !sameCounts(reveal.counts)) return state;
    const other = side === 0 ? 1 : 0;
    if (previous?.counts?.[side] !== counts[side] - 1 || previous.counts[other] !== counts[other]) return state;
    const group = state.groups[side], candidate = group.tabs[group.tabs.length - 1];
    if (!candidate || candidate.pinned || candidate.history.length !== 2 || candidate.index !== 1 || !candidate.showHidden) return state;
    const [origin, destination] = candidate.history;
    if (origin.selected.length || origin.scrollTop || destination.scrollTop || destination.selected.length !== 1) return state;
    if (destination.selected[0].split("/").slice(0, -1).join("/") !== destination.node) return state;
    const sameLocation = (left: typeof origin, right?: typeof origin) => left.rootId === right?.rootId && left.node === right.node;
    if (group.tabs.slice(0, -1).some(tab => sameLocation(destination, browserLocation(tab)))) return state;
    if (!state.groups[other].tabs.some(tab => sameLocation(destination, browserLocation(tab)))) return state;
    const tabs = group.tabs.slice(0, -1);
    const previousTab = tabs.findIndex(tab => sameLocation(origin, browserLocation(tab)));
    if (previousTab < 0) return state;
    const groups = [...state.groups] as BrowserWorkspaceState["groups"];
    groups[side] = { ...group, tabs, active: group.active === tabs.length ? previousTab : group.active };
    return { ...state, groups };
  } catch { return state; }
}
