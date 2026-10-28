import { useEffect, useState } from "react";
import { BLOCK_WORKSPACE_DISPLAY_EVENT, blockWorkspacePreferences } from "../lib/block-display-settings";

/** Every read-only projection follows the same live block display preferences. */
export function useBlockDisplayPreferences() {
  const [preferences, setPreferences] = useState(blockWorkspacePreferences);
  useEffect(() => {
    const sync = () => setPreferences(blockWorkspacePreferences());
    window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return preferences;
}
