import {
  blockWorkspacePreferences,
  BLOCK_WORKSPACE_DISPLAY_EVENT,
} from "../lib/block-display-settings";
import { useSyncExternalStore } from "react";
import {
  statusDisplays,
  STATUS_ITEMS,
} from "../lib/plugin-system/status-display";
const readFocusPreference = () =>
  blockWorkspacePreferences().statusBarInFocus !== false;
const readTotalsPreference = () => blockWorkspacePreferences().statusBarTotals !== false;
function subscribeFocusPreference(listener: () => void) {
  window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
export function useStatusBarDisplay(enabled: boolean, focusMode = false) {
  const display = useSyncExternalStore(
    statusDisplays.subscribe,
    statusDisplays.getSnapshot,
  );
  const hostShowInFocus = useSyncExternalStore(
    subscribeFocusPreference,
    readFocusPreference,
  );
  const showInFocus = display?.showInFocus ?? hostShowInFocus;
  const hostShowTotals = useSyncExternalStore(subscribeFocusPreference, readTotalsPreference);
  const showTotals = display ? display.showTotals !== false : hostShowTotals;
  const visible = (display?.visible ?? enabled) && (!focusMode || showInFocus);
  const items = display?.items ?? STATUS_ITEMS;
  return {
    display,
    visible,
    showInFocus,
    showTotals,
    items,
    navigationInStatus: visible && items.includes("navigation"),
  };
}
