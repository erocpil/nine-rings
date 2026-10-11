import type { DocumentTool } from "./result-presentation";
const KEY = "nr:pluginDocumentTools";
const CHANGE = "nr:plugin-document-tools-change";
export function documentToolEnabled(tool: DocumentTool): boolean {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}")[tool] !== false;
  } catch {
    return true;
  }
}
export function saveDocumentToolEnabled(tool: DocumentTool, enabled: boolean) {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      date: documentToolEnabled("date"),
      statistics: documentToolEnabled("statistics"),
      [tool]: enabled,
    }),
  );
  window.dispatchEvent(new Event(CHANGE));
}
export function documentToolsSnapshot() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function subscribeDocumentTools(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("storage", storage);
  };
}
