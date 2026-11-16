import { useEffect, useState } from "react";
import { BROWSER_DISPLAY_EVENT, BROWSER_DISPLAY_KEY, parseBrowserDisplay, type BrowserDisplay } from "../lib/local-files/browser-display";
import type { BrowserSettingsStore } from "../lib/local-files/browser-workspace-contract";
export function useBrowserDisplay(store: BrowserSettingsStore, side: 0 | 1) {
  const read = () => { try { return parseBrowserDisplay(store.getItem(BROWSER_DISPLAY_KEY)); } catch { return parseBrowserDisplay(null); } };
  const [settings, setSettings] = useState(read);
  useEffect(() => {
    const refresh = () => setSettings(read());
    window.addEventListener(BROWSER_DISPLAY_EVENT, refresh); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(BROWSER_DISPLAY_EVENT, refresh); window.removeEventListener("storage", refresh); };
  // The host store is stable throughout its workspace lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  return { display: settings.panes[side] ?? settings.defaults, inherited: settings.panes[side] === null,
    change(patch: Partial<BrowserDisplay> | { inherited: boolean }) {
      const next = read();
      if ("inherited" in patch) next.panes[side] = patch.inherited ? null : { ...(next.panes[side] ?? next.defaults) };
      else if (next.panes[side]) next.panes[side] = { ...next.panes[side]!, ...patch };
      else next.defaults = { ...next.defaults, ...patch };
      const normalized = parseBrowserDisplay(JSON.stringify(next));
      store.setItem(BROWSER_DISPLAY_KEY, JSON.stringify(normalized));
      setSettings(normalized); window.dispatchEvent(new Event(BROWSER_DISPLAY_EVENT));
    } };
}
