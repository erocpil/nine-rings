import type { BrowserSettingsStore } from "./browser-workspace-contract";

/** Lazy access keeps unavailable browser storage inside the caller's error path. */
export function browserSettings(prefix = ""): BrowserSettingsStore {
  return {
    getItem: key => localStorage.getItem(prefix + key),
    setItem: (key, value) => localStorage.setItem(prefix + key, value),
  };
}
