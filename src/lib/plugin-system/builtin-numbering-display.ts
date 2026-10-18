import { pluginRuntime } from "./runtime";
import { pluginLifecycle } from "./lifecycle";
import {
  numberingDisplays,
  validateNumberingDisplay,
  type NumberingDisplay,
} from "./numbering-display";
export const NUMBERING_PLUGIN_ID = "nine-rings.builtin-numbering-display";
export const NUMBERING_SETTINGS_KEY = "nr:pluginNumberingDisplay";
const EVENT = "nr:numbering-display-change";
export const DEFAULT_NUMBERING_DISPLAYS = Object.freeze(
  (["blocks", "source"] as const).map((target) =>
    validateNumberingDisplay({
      target,
      visible: true,
      relative: false,
      currentAlignment: target === "blocks" ? "right" : "left",
      font: "mono",
      fontSize: 12,
      bold: false,
      italic: false,
      color: "secondary",
      background: "transparent",
      highlightCurrent: true,
      currentBold: true,
      currentColor: "accent",
      currentBackground: "active",
      foldExpanded: "▾",
      foldCollapsed: "▸",
    }),
  ),
);
export interface NumberingPreference {
  enabled: boolean;
  displays: readonly NumberingDisplay[];
}
export function readNumberingPreference(): NumberingPreference {
  try {
    const text = localStorage.getItem(NUMBERING_SETTINGS_KEY);
    if (text) {
      const value = JSON.parse(text) as NumberingPreference;
      const displays = value.displays.map(validateNumberingDisplay);
      if (
        typeof value.enabled !== "boolean" ||
        displays.length !== 2 ||
        new Set(displays.map((display) => display.target)).size !== 2
      )
        throw Error();
      return { enabled: value.enabled, displays };
    }
  } catch {
    /* Invalid preferences leave the host unchanged. */
  }
  return { enabled: false, displays: DEFAULT_NUMBERING_DISPLAYS };
}
export const numberingPreferenceSnapshot = () => {
  try {
    return localStorage.getItem(NUMBERING_SETTINGS_KEY);
  } catch {
    return null;
  }
};
export function subscribeNumberingPreference(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === NUMBERING_SETTINGS_KEY || event.key === null) listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}
export function saveNumberingPreference(value: NumberingPreference) {
  const displays = value.displays.map(validateNumberingDisplay);
  if (
    typeof value.enabled !== "boolean" ||
    displays.length !== 2 ||
    new Set(displays.map((item) => item.target)).size !== 2
  )
    throw Error("编号插件配置无效");
  localStorage.setItem(
    NUMBERING_SETTINGS_KEY,
    JSON.stringify({ enabled: value.enabled, displays }),
  );
  window.dispatchEvent(new Event(EVENT));
}
export function startBuiltinNumberingDisplay() {
  let stopped = false,
    version = 0,
    generation: string | undefined;
  let enabled = pluginRuntime.isEnabled(),
    queue = Promise.resolve();
  const owns = () =>
    pluginRuntime
      .getStatus()
      .activations.some(
        (item) =>
          item.pluginId === NUMBERING_PLUGIN_ID &&
          item.generation === generation,
      );
  const reconcile = () => {
    const requested = ++version;
    queue = queue
      .then(async () => {
        if (stopped || requested !== version) return;
        if (owns()) await pluginLifecycle.deactivate(NUMBERING_PLUGIN_ID);
        if (stopped || requested !== version || !pluginRuntime.isEnabled())
          return;
        const preference = readNumberingPreference();
        if (!preference.enabled) return;
        if (
          (["blocks", "source"] as const).some((target) => {
            const owner = numberingDisplays.getOwner(target);
            return owner !== null && owner !== NUMBERING_PLUGIN_ID;
          })
        )
          return;
        const owner = await pluginLifecycle.activate(NUMBERING_PLUGIN_ID, [], {
          activate: (scope) => {
            numberingDisplays.register(scope.activation, preference.displays);
          },
        });
        generation = owner.generation;
        if (stopped || requested !== version)
          if (owns()) await pluginLifecycle.deactivate(NUMBERING_PLUGIN_ID);
      })
      .catch(() => {
        /* Lifecycle records invalid or conflicting contributions. */
      });
  };
  const stopPreference = subscribeNumberingPreference(reconcile);
  const stopRuntime = pluginRuntime.subscribe(() => {
    const next = pluginRuntime.isEnabled();
    if (enabled !== next) {
      enabled = next;
      reconcile();
    }
  });
  reconcile();
  return () => {
    stopped = true;
    ++version;
    stopPreference();
    stopRuntime();
    if (owns()) void pluginLifecycle.deactivate(NUMBERING_PLUGIN_ID);
  };
}
