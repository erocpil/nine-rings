import { useSyncExternalStore } from "react";
import { blockWorkspacePreferences, saveBlockWorkspacePreferences, BLOCK_WORKSPACE_DISPLAY_EVENT } from "../lib/block-display-settings";

const subscribe = (notify: () => void) => {
  window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, notify);
    window.removeEventListener("storage", notify);
  };
};
export function SettingsQuoteAlerts({ onMessage }: { onMessage: (text: string) => void }) {
  const value = useSyncExternalStore(subscribe, () => blockWorkspacePreferences().quoteAlertColors ?? "semantic");
  return <select aria-label="提示引用配色" value={value} onChange={event => {
    saveBlockWorkspacePreferences({ quoteAlertColors: event.target.value === "style" ? "style" : "semantic" });
    onMessage("已更新");
  }}>
    <option value="semantic">语义配色（自动适配）</option>
    <option value="style">跟随风格</option>
  </select>;
}
