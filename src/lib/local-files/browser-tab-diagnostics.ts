import type { BrowserSettingsStore } from "./browser-workspace-contract";
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
