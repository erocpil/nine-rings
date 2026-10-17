import { pluginLifecycle } from "./lifecycle";
import { pluginRuntime } from "./runtime";
import { themeResources } from "./theme-resources";
import {
  BUILTIN_THEME_RESOURCES,
  THEME_PLUGIN_ID,
} from "./builtin-theme-resources";
import {
  readThemePreference,
  subscribeThemePreference,
} from "./theme-preferences";
import { startThemeApplication } from "./theme-application";

/** Trusted resource provider. Selection changes don't revoke/re-register live resources. */
export function startBuiltinThemes() {
  let stopped = false,
    revision = 0,
    enabled = pluginRuntime.isEnabled();
  let queue = Promise.resolve();
  const reconcile = () => {
    const requested = ++revision;
    queue = queue
      .then(async () => {
        if (stopped || requested !== revision) return;
        const wanted = () =>
          pluginRuntime.isEnabled() && readThemePreference().enabled;
        if (
          wanted() &&
          pluginRuntime
            .getStatus()
            .activations.some((entry) => entry.pluginId === THEME_PLUGIN_ID)
        )
          return;
        await pluginLifecycle.deactivate(THEME_PLUGIN_ID);
        if (stopped || requested !== revision || !wanted()) return;
        await pluginLifecycle.activate(THEME_PLUGIN_ID, [], {
          activate(owner) {
            themeResources.register(owner.activation, BUILTIN_THEME_RESOURCES);
          },
        });
      })
      .catch(() => {
        /* Lifecycle records errors; the host palette remains available. */
      });
  };
  const unsubscribeRuntime = pluginRuntime.subscribe(() => {
    const next = pluginRuntime.isEnabled();
    if (next !== enabled) {
      enabled = next;
      reconcile();
    }
  });
  const unsubscribePreference = subscribeThemePreference(reconcile);
  const stopApplication = startThemeApplication();
  reconcile();
  return () => {
    stopped = true;
    ++revision;
    unsubscribeRuntime();
    unsubscribePreference();
    stopApplication();
    void pluginLifecycle.deactivate(THEME_PLUGIN_ID).catch(() => {});
  };
}
