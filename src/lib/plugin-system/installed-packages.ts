import { pluginRuntime } from "./runtime";
import { pluginLifecycle } from "./lifecycle";
import { themeResources } from "./theme-resources";
import { listPluginPackages, subscribePluginPackages } from "./package-store";

/** No package code runs: the host validates data then owns the registry and cleanup. */
export function startInstalledPluginPackages() {
  let stopped = false,
    revision = 0,
    enabled = pluginRuntime.isEnabled();
  let queue = Promise.resolve();
  const active = new Map<string, { digest: string; generation: string }>();
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
          }
        }
        if (!wanted.length) return;
        const { validatePluginPackage } = await import("./package-validation");
        for (const record of wanted) {
          if (stopped || requested !== revision || !pluginRuntime.isEnabled())
            return;
          if (active.get(record.id)?.digest === record.digest) continue;
          if (record.trustedDigest !== record.digest) continue;
          try {
            const encoder = new TextEncoder();
            const data = await validatePluginPackage(
              Object.fromEntries(
                Object.entries(record.files).map(([path, text]) => [
                  path,
                  encoder.encode(text),
                ]),
              ),
            );
            if (
              data.id !== record.id ||
              data.digest !== record.trustedDigest ||
              data.version !== record.version
            )
              throw Error("已安装插件指纹变化，需要重新审查");
            if (stopped || requested !== revision || !pluginRuntime.isEnabled())
              return;
            const activation = await pluginLifecycle.activate(data.id, [], {
              activate(owner) {
                themeResources.register(owner.activation, data.themes);
              },
            });
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
            });
          } catch {
            pluginRuntime.recordLifecycleFailure(
              record.id,
              "activate",
              "INVALID_ARGUMENT",
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
    for (const [id, entry] of active)
      if (owns(id, entry.generation)) void pluginLifecycle.deactivate(id);
    active.clear();
  };
}
