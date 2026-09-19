import { useMemo, useSyncExternalStore } from "react";
import {
  readWorkspaceLayout,
  WORKSPACE_LAYOUT_EVENT,
} from "../lib/workspace-layout";
const snapshot = () => JSON.stringify(readWorkspaceLayout());
const subscribe = (notify: () => void) => {
  window.addEventListener(WORKSPACE_LAYOUT_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(WORKSPACE_LAYOUT_EVENT, notify);
    window.removeEventListener("storage", notify);
  };
};
export function useWorkspaceLayout() {
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(
    () => JSON.parse(value) as ReturnType<typeof readWorkspaceLayout>,
    [value],
  );
}
