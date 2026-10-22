import { useSyncExternalStore } from "react";
import {
  BLOCK_WORKSPACE_DISPLAY_EVENT,
  blockWorkspacePreferences,
  saveBlockWorkspacePreferences,
} from "../lib/block-display-settings";
import { ToolbarIcon } from "./ToolbarIcon";

function subscribe(listener: () => void) {
  window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

function readEnabled() {
  return blockWorkspacePreferences().sourceWhitespace === true;
}

export function SourceWhitespaceToggle({ className = "" }: { className?: string }) {
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => false);
  const label = enabled ? "隐藏不可见字符" : "显示不可见字符";
  return (
    <button
      type="button"
      className={className || undefined}
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => saveBlockWorkspacePreferences({ sourceWhitespace: !enabled })}
    >
      <ToolbarIcon name="listChars" />
    </button>
  );
}
