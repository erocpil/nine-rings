import { pluginLifecycle } from "./lifecycle";
import { pluginRuntime } from "./runtime";
import {
  panelDisplays,
  validatePanelDisplay,
  type PanelDisplayContribution,
} from "./panel-display";

export const TREE_DISPLAY_PLUGIN_ID = "nine-rings.builtin-tree-display";
export const TREE_DISPLAY_SETTINGS_KEY = "nr:pluginTreeDisplay";
const CHANGE = "nr:plugin-tree-display-change";
export const DEFAULT_TREE_DISPLAY: PanelDisplayContribution = Object.freeze({
  target: "document-tree",
  font: "inherit",
  fontSize: 14,
  rowHeight: 30,
  labelColor: "inherit",
  tooltip: "path",
  showCounts: true,
  showMetadata: true,
  toolbar: Object.freeze(["tree.expand-all", "tree.refresh"] as const),
});
export interface TreeDisplayPreference {
  enabled: boolean;
  display: PanelDisplayContribution;
}
export function readTreeDisplayPreference(): TreeDisplayPreference {
  try {
    const raw = localStorage.getItem(TREE_DISPLAY_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TreeDisplayPreference;
      if (
        typeof parsed.enabled !== "boolean" ||
        parsed.display?.target !== "document-tree"
      )
        throw new Error("Invalid preference");
      return {
        enabled: parsed.enabled,
        display: validatePanelDisplay(parsed.display),
      };
    }
  } catch {
    /* Invalid or inaccessible local settings use the host view. */
  }
  return { enabled: false, display: DEFAULT_TREE_DISPLAY };
}
export const treeDisplayPreferenceSnapshot = () => {
  try {
    return localStorage.getItem(TREE_DISPLAY_SETTINGS_KEY);
  } catch {
    return null;
  }
};
export const subscribeTreeDisplayPreference = (listener: () => void) => {
  const storage = (event: StorageEvent) => {
    if (event.key === TREE_DISPLAY_SETTINGS_KEY || event.key === null)
      listener();
  };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("storage", storage);
  };
};
export function saveTreeDisplayPreference(value: TreeDisplayPreference) {
  if (
    typeof value.enabled !== "boolean" ||
    value.display.target !== "document-tree"
  )
    throw new Error("Invalid preference");
  const display = validatePanelDisplay(value.display);
  localStorage.setItem(
    TREE_DISPLAY_SETTINGS_KEY,
    JSON.stringify({ enabled: value.enabled, display }),
  );
  window.dispatchEvent(new Event(CHANGE));
}

/** Serialized activation changes; manual deactivation stays off until a user changes settings. */
export function startBuiltinTreeDisplay(): () => void {
  let stopped = false;
  let revision = 0;
  let queue = Promise.resolve();
  let enabled = pluginRuntime.isEnabled();
  const reconcile = () => {
    const requested = ++revision;
    queue = queue
      .then(async () => {
        if (stopped || requested !== revision) return;
        await pluginLifecycle.deactivate(TREE_DISPLAY_PLUGIN_ID);
        if (stopped || requested !== revision || !pluginRuntime.isEnabled())
          return;
        const preference = readTreeDisplayPreference();
        if (!preference.enabled) return;
        await pluginLifecycle.activate(TREE_DISPLAY_PLUGIN_ID, [], {
          activate(owner) {
            panelDisplays.register(owner.activation, preference.display);
          },
        });
      })
      .catch(() => {
        /* Lifecycle records activation failures; host view remains available. */
      });
  };
  const unsubscribeRuntime = pluginRuntime.subscribe(() => {
    const next = pluginRuntime.isEnabled();
    if (enabled !== next) {
      enabled = next;
      reconcile();
    }
  });
  const unsubscribePreference = subscribeTreeDisplayPreference(reconcile);
  reconcile();
  return () => {
    stopped = true;
    ++revision;
    unsubscribeRuntime();
    unsubscribePreference();
    void pluginLifecycle.deactivate(TREE_DISPLAY_PLUGIN_ID).catch(() => {});
  };
}
