import { useEffect, useState } from "react";
import {
  BLOCK_WORKSPACE_DISPLAY_EVENT,
  blockWorkspacePreferences,
  saveBlockWorkspacePreferences,
} from "../lib/block-display-settings";
import { EditorStatusSelect } from "./EditorStatusSelect";

/** Display-only Tab width. It never rewrites indentation and remains safe in read-only views. */
export function SourceTabWidthSelect() {
  const [size, setSize] = useState(() => blockWorkspacePreferences().tabSize ?? 4);
  useEffect(() => {
    const sync = () => setSize(blockWorkspacePreferences().tabSize ?? 4);
    window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return <EditorStatusSelect
    label="Tab Size"
    title="Tab 显示列数；不修改源码"
    value={String(size)}
    options={[...new Set([2, 4, 8, size])].sort((a, b) => a - b).map(value => ({ value: String(value), label: `Tab ${value}` }))}
    onChange={value => saveBlockWorkspacePreferences({ tabSize: Number(value) })}
  />;
}
