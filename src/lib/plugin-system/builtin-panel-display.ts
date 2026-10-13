import { pluginLifecycle } from "./lifecycle";
import { pluginRuntime } from "./runtime";
import {
  panelDisplays,
  validatePanelDisplay,
  type PanelDisplayContribution,
} from "./panel-display";

export interface PanelDisplayPreference {
  enabled: boolean;
  display: PanelDisplayContribution;
}
/** Shared local preferences and supervised lifecycle for declarative panel presenters. */
export function createBuiltinPanelDisplay(
  pluginId: string,
  settingsKey: string,
  defaults: PanelDisplayContribution,
  changeEvent = `${settingsKey}:change`,
) {
  function read(): PanelDisplayPreference {
    try {
      const raw = localStorage.getItem(settingsKey);
      if (raw) {
        const parsed = JSON.parse(raw) as PanelDisplayPreference;
        if (
          typeof parsed.enabled !== "boolean" ||
          parsed.display?.target !== defaults.target
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
    return { enabled: false, display: defaults };
  }
  const snapshot = () => {
    try {
      return localStorage.getItem(settingsKey);
    } catch {
      return null;
    }
  };
  const subscribe = (listener: () => void) => {
    const storage = (event: StorageEvent) => {
      if (event.key === settingsKey || event.key === null) listener();
    };
    window.addEventListener(changeEvent, listener);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(changeEvent, listener);
      window.removeEventListener("storage", storage);
    };
  };
  function save(value: PanelDisplayPreference) {
    if (
      typeof value.enabled !== "boolean" ||
      value.display.target !== defaults.target
    )
      throw new Error("Invalid preference");
    const display = validatePanelDisplay(value.display);
    localStorage.setItem(
      settingsKey,
      JSON.stringify({ enabled: value.enabled, display }),
    );
    window.dispatchEvent(new Event(changeEvent));
  }

  /** Serialized activation changes; manual deactivation stays off until a user changes settings. */
  function start(): () => void {
    let stopped = false;
    let revision = 0;
    let queue = Promise.resolve();
    let enabled = pluginRuntime.isEnabled();
    const reconcile = () => {
      const requested = ++revision;
      queue = queue
        .then(async () => {
          if (stopped || requested !== revision) return;
          await pluginLifecycle.deactivate(pluginId);
          if (stopped || requested !== revision || !pluginRuntime.isEnabled())
            return;
          const preference = read();
          if (!preference.enabled) return;
          await pluginLifecycle.activate(pluginId, [], {
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
    const unsubscribePreference = subscribe(reconcile);
    reconcile();
    return () => {
      stopped = true;
      ++revision;
      unsubscribeRuntime();
      unsubscribePreference();
      void pluginLifecycle.deactivate(pluginId).catch(() => {});
    };
  }

  return { read, snapshot, subscribe, save, start, defaults };
}
