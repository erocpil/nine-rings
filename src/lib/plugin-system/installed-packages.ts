import { statusDisplays } from "./status-display";
import { numberingDisplays } from "./numbering-display";
import { actionResources } from "./action-resources";
import { contentResources } from "./content-resources";
import { PluginHostError, pluginRuntime } from "./runtime";
import { pluginLifecycle } from "./lifecycle";
import { NUMBERING_PLUGIN_ID } from "./builtin-numbering-display";
import {
  STATUS_DISPLAY_CHANGE_EVENT,
  STATUS_PLUGIN_ID,
} from "./builtin-status-display";
import { themeResources } from "./theme-resources";
import { listPluginPackages, subscribePluginPackages } from "./package-store";

/** No package code runs: the host validates data then owns the registry and cleanup. */
export function startInstalledPluginPackages() {
  let stopped = false,
    revision = 0,
    enabled = pluginRuntime.isEnabled();
  let queue = Promise.resolve();
  const active = new Map<string, {
    digest: string;
    generation: string;
    controlsNumbering: boolean;
    controlsStatus: boolean;
  }>();
  const owns = (id: string, generation: string) =>
    pluginRuntime
      .getStatus()
      .activations.some(
        (value) => value.pluginId === id && value.generation === generation,
      );
  const reconcile = () => {
    const requested = ++revision;
    queue = queue
      .then(async () => {
        if (stopped || requested !== revision) return;
        const records = pluginRuntime.isEnabled()
          ? await listPluginPackages()
          : [];
        if (stopped || requested !== revision) return;
        const wanted = pluginRuntime.isEnabled()
          ? records.filter((row) => row.enabled)
          : [];
        for (const [id, entry] of active) {
          if (
            !wanted.some(
              (row) =>
                row.id === id &&
                row.digest === entry.digest &&
                row.trustedDigest === entry.digest,
            )
          ) {
            if (owns(id, entry.generation))
              await pluginLifecycle.deactivate(id);
            active.delete(id);
            if (entry.controlsNumbering)
              window.dispatchEvent(new Event("nr:numbering-display-change"));
            if (entry.controlsStatus)
              window.dispatchEvent(new Event(STATUS_DISPLAY_CHANGE_EVENT));
          }
        }
        if (!wanted.length) return;
        const { validatePluginPackage } = await import("./package-validation");
        for (const record of wanted) {
          if (stopped || requested !== revision || !pluginRuntime.isEnabled())
            return;
          if (active.get(record.id)?.digest === record.digest) continue;
          if (record.trustedDigest !== record.digest) continue;
          let controlsNumbering = false;
          let controlsStatus = false;
          try {
            const encoder = new TextEncoder();
            let data;
            try {
              data = await validatePluginPackage(
                Object.fromEntries(
                  Object.entries(record.files).map(([path, text]) => [
                    path,
                    encoder.encode(text),
                  ]),
                ),
              );
            } catch (error) {
              throw new PluginHostError(
                "INVALID_ARGUMENT",
                error instanceof Error ? error.message : "插件包验证失败",
              );
            }
            if (
              data.id !== record.id ||
              data.digest !== record.trustedDigest ||
              data.version !== record.version
            )
              throw new PluginHostError(
                "INVALID_ARGUMENT",
                "已安装插件指纹变化，需要重新审查",
              );
            if (stopped || requested !== revision || !pluginRuntime.isEnabled())
              return;
            controlsNumbering = data.gutters.length > 0;
            controlsStatus = data.statusBar !== null;
            // A declarative package owns the active presentation while enabled;
            // retain built-in preferences and let their controllers restore them
            // when the package is later disabled or removed.
            if (controlsNumbering)
              await pluginLifecycle.deactivate(NUMBERING_PLUGIN_ID);
            if (controlsStatus)
              await pluginLifecycle.deactivate(STATUS_PLUGIN_ID);
            const activation = await pluginLifecycle.activate(
              data.id,
              [
                ...(data.content.some((entry) =>
                  entry.usage.includes("insert"),
                ) ||
                data.actions.some(
                  (action) => action.kind === "macro" && action.writes,
                )
                  ? [
                      "editor.selection.read" as const,
                      "editor.selection.write" as const,
                    ]
                  : []),
                ...(data.content.some((entry) =>
                  entry.usage.includes("insert"),
                ) || data.actions.some((action) => action.kind === "macro")
                  ? ["documents.current.read" as const]
                  : []),
                ...(data.actions.some((action) => action.kind === "query")
                  ? ["documents.metadata.read" as const]
                  : []),
              ],
              {
                activate(owner) {
                  if (data.gutters.length) numberingDisplays.register(owner.activation, data.gutters);
                  if (data.statusBar) statusDisplays.register(owner.activation, data.statusBar);
                  if (data.themes.length)
                    themeResources.register(owner.activation, data.themes);
                  if (data.actions.length)
                    actionResources.register(owner.activation, data.actions);
                  if (data.content.length)
                    contentResources.register(owner.activation, data.content);
                },
              },
            );
            if (
              stopped ||
              requested !== revision ||
              !pluginRuntime.isEnabled()
            ) {
              if (
                pluginRuntime
                  .getStatus()
                  .activations.some(
                    (value) =>
                      value.pluginId === data.id &&
                      value.generation === activation.generation,
                  )
              )
                await pluginLifecycle.deactivate(data.id);
              return;
            }
            active.set(data.id, {
              digest: data.digest,
              generation: activation.generation,
              controlsNumbering,
              controlsStatus,
            });
          } catch (error) {
            if (controlsNumbering)
              window.dispatchEvent(new Event("nr:numbering-display-change"));
            if (controlsStatus)
              window.dispatchEvent(new Event(STATUS_DISPLAY_CHANGE_EVENT));
            pluginRuntime.recordLifecycleFailure(
              record.id,
              "activate",
              error instanceof PluginHostError
                ? error.code
                : "INTERNAL_ERROR",
            );
          }
        }
      })
      .catch(() => {
        /* Never execute unvalidated bytes when storage/validation fails. */
      });
  };
  const unsubscribePackages = subscribePluginPackages(reconcile);
  const unsubscribeRuntime = pluginRuntime.subscribe(() => {
    const value = pluginRuntime.isEnabled();
    if (enabled !== value) {
      enabled = value;
      if (!value) active.clear(); // Runtime has synchronously revoked all activations.
      reconcile();
    }
  });
  reconcile();
  return () => {
    stopped = true;
    ++revision;
    unsubscribePackages();
    unsubscribeRuntime();
    for (const [id, entry] of active) {
      if (owns(id, entry.generation)) void pluginLifecycle.deactivate(id);
      if (entry.controlsNumbering)
        window.dispatchEvent(new Event("nr:numbering-display-change"));
      if (entry.controlsStatus)
        window.dispatchEvent(new Event(STATUS_DISPLAY_CHANGE_EVENT));
    }
    active.clear();
  };
}
