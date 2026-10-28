import { useMemo, useSyncExternalStore } from "react";
import {
  DOCUMENT_WORKSPACE_EVENT,
  readDocumentWorkspace,
} from "../lib/document-workspace-layout";
const snapshot = () => JSON.stringify(readDocumentWorkspace());
const subscribe = (notify: () => void) => {
  window.addEventListener(DOCUMENT_WORKSPACE_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(DOCUMENT_WORKSPACE_EVENT, notify);
    window.removeEventListener("storage", notify);
  };
};
export function useDocumentWorkspace() {
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(
    () => JSON.parse(value) as ReturnType<typeof readDocumentWorkspace>,
    [value],
  );
}
