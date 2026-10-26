import { useNumberingDisplay } from "./useNumberingDisplay";
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
    sourceFoldGutter: preferences.sourceFoldGutter !== false,
    sourceFoldConnectorStyle: preferences.sourceFoldConnectorStyle ?? "solid",
    sourceFoldConnectorWidth: preferences.sourceFoldConnectorWidth ?? 2,
    sourceFoldConnectorOpacity: preferences.sourceFoldConnectorOpacity ?? 100,
  };
}
export function useRelativeNumbering() {
  const plugin = useNumberingDisplay();
  const [value, setValue] = useState(read);
  useEffect(() => {
    const sync = () => {
      const next = read();
      setValue((old) =>
        old.relativeBlockNumbers === next.relativeBlockNumbers &&
        old.relativeSourceLineNumbers === next.relativeSourceLineNumbers &&
        old.sourceFoldGutter === next.sourceFoldGutter &&
        old.sourceFoldConnectorStyle === next.sourceFoldConnectorStyle &&
        old.sourceFoldConnectorWidth === next.sourceFoldConnectorWidth &&
        old.sourceFoldConnectorOpacity === next.sourceFoldConnectorOpacity &&
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
  return {
    sourceFoldGutter: value.sourceFoldGutter,
    sourceFoldConnectorStyle: value.sourceFoldConnectorStyle,
    sourceFoldConnectorWidth: value.sourceFoldConnectorWidth,
    sourceFoldConnectorOpacity: value.sourceFoldConnectorOpacity,
    relativeBlockNumbers: plugin.blocks?.relative ?? value.relativeBlockNumbers,
    relativeSourceLineNumbers: plugin.source?.relative ?? value.relativeSourceLineNumbers,
    relativeBlockNumberAlignment: plugin.blocks?.currentAlignment ?? value.relativeBlockNumberAlignment,
    relativeSourceLineNumberAlignment: plugin.source?.currentAlignment ?? value.relativeSourceLineNumberAlignment,
  };
}
