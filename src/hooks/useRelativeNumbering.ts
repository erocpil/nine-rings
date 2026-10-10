import { useEffect, useState } from "react";
import {
  blockWorkspacePreferences,
  BLOCK_WORKSPACE_DISPLAY_EVENT,
} from "../lib/block-display-settings";

function read() {
  const preferences = blockWorkspacePreferences();
  return {
    relativeBlockNumberAlignment:
      preferences.relativeBlockNumberAlignment ?? "right",
    relativeSourceLineNumberAlignment:
      preferences.relativeSourceLineNumberAlignment ?? "left",
    relativeBlockNumbers: preferences.relativeBlockNumbers === true,
    relativeSourceLineNumbers: preferences.relativeSourceLineNumbers === true,
  };
}
export function useRelativeNumbering() {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const sync = () => {
      const next = read();
      setValue((old) =>
        old.relativeBlockNumbers === next.relativeBlockNumbers &&
        old.relativeSourceLineNumbers === next.relativeSourceLineNumbers &&
        old.relativeBlockNumberAlignment ===
          next.relativeBlockNumberAlignment &&
        old.relativeSourceLineNumberAlignment ===
          next.relativeSourceLineNumberAlignment
          ? old
          : next,
      );
    };
    sync();
    window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return value;
}
