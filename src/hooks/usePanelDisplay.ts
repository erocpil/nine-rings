import { useSyncExternalStore } from "react";
import {
  panelDisplays,
  type PanelDisplayTarget,
} from "../lib/plugin-system/panel-display";

export function usePanelDisplay(target: PanelDisplayTarget) {
  return useSyncExternalStore(
    panelDisplays.subscribe,
    () => panelDisplays.get(target),
    () => null,
  );
}
