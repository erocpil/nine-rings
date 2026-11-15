import { useEffect, useState } from "react";
import type { BrowserSettingsStore } from "../lib/local-files/browser-workspace-contract";
import { BROWSER_SHORTCUTS_EVENT, readBrowserShortcuts } from "../lib/local-files/browser-shortcuts";

export function useBrowserShortcuts(store: BrowserSettingsStore) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const [shortcuts, setShortcuts] = useState(() => readBrowserShortcuts(store, mac));
  useEffect(() => {
    const changed = () => setShortcuts(readBrowserShortcuts(store, mac));
    changed();
    window.addEventListener(BROWSER_SHORTCUTS_EVENT, changed);
    window.addEventListener("storage", changed);
    return () => { window.removeEventListener(BROWSER_SHORTCUTS_EVENT, changed); window.removeEventListener("storage", changed); };
  }, [store, mac]);
  return { shortcuts, mac };
}
