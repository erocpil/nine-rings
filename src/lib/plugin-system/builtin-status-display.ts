import { pluginRuntime } from "./runtime";
import { pluginLifecycle } from "./lifecycle";
import {
  statusDisplays,
  validateStatusDisplay,
  DEFAULT_STATUS_DISPLAY,
  type StatusDisplay,
} from "./status-display";
export const STATUS_PLUGIN_ID = "nine-rings.builtin-status-display";
export const STATUS_SETTINGS_KEY = "nr:pluginStatusDisplay";
const EVENT = "nr:status-display-change";
export interface StatusPreference {
  enabled: boolean;
  display: StatusDisplay;
}
export function readStatusPreference(): StatusPreference {
  try {
    const text = localStorage.getItem(STATUS_SETTINGS_KEY);
    if (text) {
      const v = JSON.parse(text) as StatusPreference;
      if (typeof v.enabled !== "boolean") throw Error();
      return { enabled: v.enabled, display: validateStatusDisplay(v.display) };
    }
  } catch {
    /* Invalid preferences leave host settings intact. */
  }
  return { enabled: false, display: DEFAULT_STATUS_DISPLAY };
}
export const statusPreferenceSnapshot = () => {
  try {
    return localStorage.getItem(STATUS_SETTINGS_KEY);
  } catch {
    return null;
  }
};
export function subscribeStatusPreference(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === STATUS_SETTINGS_KEY || event.key === null) listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}
export function saveStatusPreference(value: StatusPreference) {
  const display = validateStatusDisplay(value.display);
  if (typeof value.enabled !== "boolean") throw Error("状态栏插件配置无效");
  localStorage.setItem(
    STATUS_SETTINGS_KEY,
    JSON.stringify({ enabled: value.enabled, display }),
  );
  window.dispatchEvent(new Event(EVENT));
}
export function startBuiltinStatusDisplay() {
  let stopped = false,
    revision = 0,
    generation: string | undefined;
  let enabled = pluginRuntime.isEnabled(),
    queue = Promise.resolve();
  const owns = () =>
    pluginRuntime
      .getStatus()
      .activations.some(
        (a) => a.pluginId === STATUS_PLUGIN_ID && a.generation === generation,
      );
  const reconcile = () => {
    const requested = ++revision;
    queue = queue
      .then(async () => {
        if (stopped || requested !== revision) return;
        if (owns()) await pluginLifecycle.deactivate(STATUS_PLUGIN_ID);
        if (stopped || requested !== revision || !pluginRuntime.isEnabled())
          return;
        const preference = readStatusPreference();
        if (!preference.enabled) return;
        const owner = await pluginLifecycle.activate(STATUS_PLUGIN_ID, [], {
          activate(scope) {
            statusDisplays.register(scope.activation, preference.display);
          },
        });
        generation = owner.generation;
        if ((stopped || requested !== revision) && owns())
          await pluginLifecycle.deactivate(STATUS_PLUGIN_ID);
      })
      .catch(() => {
        /* Lifecycle records conflicts and activation failures. */
      });
  };
  const stopPreference = subscribeStatusPreference(reconcile);
  const stopRuntime = pluginRuntime.subscribe(() => {
    const next = pluginRuntime.isEnabled();
    if (next !== enabled) {
      enabled = next;
      reconcile();
    }
  });
  reconcile();
  return () => {
    stopped = true;
    ++revision;
    stopPreference();
    stopRuntime();
    if (owns()) void pluginLifecycle.deactivate(STATUS_PLUGIN_ID);
  };
}
