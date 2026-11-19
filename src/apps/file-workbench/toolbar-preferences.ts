import { useFocusEditorTools } from "../../stores/useFocusEditorTools";
import type { BrowserSettingsStore } from "../../lib/local-files/browser-workspace-contract";

export const TOOLBAR_PREFERENCES_KEY = "editor-toolbar";
export const TOOLBAR_PREFERENCES_ERROR = "file-workbench:toolbar-preferences-error";
function read(store: BrowserSettingsStore): boolean | null {
  try {
    const value = JSON.parse(store.getItem(TOOLBAR_PREFERENCES_KEY) ?? "null");
    return typeof value?.expanded === "boolean" ? value.expanded : null;
  } catch { return null; }
}
type Tools = Pick<typeof useFocusEditorTools, "getState" | "setState">;
/** Install only in Workbench: all shared source/rendered buttons keep using the
 * same store, while Nine Rings retains its existing toolbar lifetime policy. */
export function installWorkbenchToolbarPreferences(store: BrowserSettingsStore,
  report: (cause: unknown) => void, tools: Tools = useFocusEditorTools, events: EventTarget = window) {
  const previous = tools.getState();
  const setExpanded = (expanded: boolean | null) => {
    try { store.setItem(TOOLBAR_PREFERENCES_KEY, JSON.stringify({ expanded })); }
    catch (cause) { report(cause); return; }
    previous.setExpanded(expanded);
  };
  tools.setState({ expanded: read(store), setExpanded });
  const sync = () => tools.setState({ expanded: read(store) });
  events.addEventListener("storage", sync);
  return () => {
    events.removeEventListener("storage", sync);
    if (tools.getState().setExpanded === setExpanded) tools.setState({ expanded: previous.expanded, setExpanded: previous.setExpanded });
  };
}
