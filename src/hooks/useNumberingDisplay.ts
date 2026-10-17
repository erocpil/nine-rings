import { useSyncExternalStore } from "react";
import { numberingDisplays } from "../lib/plugin-system/numbering-display";
export function useNumberingDisplay() {
  return useSyncExternalStore(
    numberingDisplays.subscribe,
    numberingDisplays.getSnapshot,
  );
}
