import {
  pluginRuntime,
  PluginHostError,
  type PluginActivation,
  type PluginPermission,
  type PluginRuntime,
} from "./runtime";

export interface PluginActivationContext {
  readonly activation: PluginActivation;
  readonly signal: AbortSignal;
  own(cleanup: () => void): () => void;
}
type Hooks = {
  activate(context: PluginActivationContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
};
/** Trusted builtin modules only. No source evaluation, filesystem entry or package loading. */
export class PluginLifecycle {
  private entries = new Map<
    string,
    {
      activation: PluginActivation;
      hooks: Hooks;
      phase: "starting" | "active" | "stopping";
      stop?: Promise<void>;
      timeoutMs: number;
    }
  >();
  constructor(private runtime: PluginRuntime) {}
  private async bounded(
    task: () => void | Promise<void>,
    signal?: AbortSignal,
    timeoutMs = 30000,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
      throw new PluginHostError("INVALID_ARGUMENT", "生命周期超时预算无效");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};
    const stopped = new Promise<never>((_, reject) => {
      abort = () =>
        reject(new PluginHostError("PLUGIN_DISABLED", "激活已取消"));
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => reject(new PluginHostError("TIMEOUT", "生命周期超时")),
        timeoutMs,
      );
      if (signal?.aborted) abort();
    });
    try {
      if (signal?.aborted)
        throw new PluginHostError("PLUGIN_DISABLED", "激活已取消");
      await Promise.race([
        Promise.resolve().then(() => {
          if (signal?.aborted)
            throw new PluginHostError("PLUGIN_DISABLED", "激活已取消");
          return task();
        }),
        stopped,
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  async activate(
    pluginId: string,
    permissions: readonly PluginPermission[],
    hooks: Hooks,
    timeoutMs = 30000,
  ) {
    if (this.entries.has(pluginId))
      throw new PluginHostError(
        "INVALID_ARGUMENT",
        "插件生命周期操作正在进行或已激活",
      );
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
      throw new PluginHostError("INVALID_ARGUMENT", "生命周期超时预算无效");
    const activation = this.runtime.activate(pluginId, permissions);
    const entry = {
      activation,
      hooks,
      timeoutMs,
      stop: undefined as Promise<void> | undefined,
      phase: "starting" as "starting" | "active" | "stopping",
    };
    this.entries.set(pluginId, entry);
    const signal = this.runtime.assert(activation);
    const detach = this.runtime.own(activation, () => {
      void this.stop(pluginId, entry).catch(() => {});
    });
    try {
      await this.bounded(
        () =>
          hooks.activate(
            Object.freeze({
              activation,
              signal,
              own: (cleanup: () => void) =>
                this.runtime.own(activation, cleanup),
            }),
          ),
        signal,
        timeoutMs,
      );
      this.runtime.assert(activation);
      entry.phase = "active";
      return activation;
    } catch (error) {
      // Never cancel a newer activation issued directly by another trusted owner.
      try {
        this.runtime.assert(activation);
        this.runtime.deactivate(pluginId);
      } catch {
        detach();
      }
      const code =
        error instanceof PluginHostError ? error.code : "INTERNAL_ERROR";
      if (code !== "PLUGIN_DISABLED")
        this.runtime.recordLifecycleFailure(pluginId, "activate", code);
      if (error instanceof PluginHostError) throw error;
      throw new PluginHostError(
        "INTERNAL_ERROR",
        "插件激活失败，已释放托管资源",
      );
    }
  }
  private stop(
    pluginId: string,
    entry: {
      activation: PluginActivation;
      hooks: Hooks;
      phase: "starting" | "active" | "stopping";
      stop?: Promise<void>;
      timeoutMs: number;
    },
  ): Promise<void> {
    if (entry.stop) return entry.stop;
    entry.phase = "stopping";
    if (!entry.hooks.deactivate) {
      if (this.entries.get(pluginId) === entry) this.entries.delete(pluginId);
      return (entry.stop = Promise.resolve());
    }
    entry.stop = this.bounded(
      () => entry.hooks.deactivate!(),
      undefined,
      entry.timeoutMs,
    )
      .catch((error) => {
        this.runtime.recordCleanupFailure();
        this.runtime.recordLifecycleFailure(
          pluginId,
          "deactivate",
          error instanceof PluginHostError ? error.code : "INTERNAL_ERROR",
        );
        if (error instanceof PluginHostError) throw error;
        throw new PluginHostError(
          "INTERNAL_ERROR",
          "插件停用清理失败，权限已撤销",
        );
      })
      .finally(() => {
        if (this.entries.get(pluginId) === entry) this.entries.delete(pluginId);
      });
    return entry.stop;
  }
  async deactivate(pluginId: string, timeoutMs = 30000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
      throw new PluginHostError("INVALID_ARGUMENT", "生命周期超时预算无效");
    const entry = this.entries.get(pluginId);
    if (!entry) {
      this.runtime.deactivate(pluginId);
      return;
    }
    entry.timeoutMs = timeoutMs;
    this.runtime.deactivate(pluginId);
    await this.stop(pluginId, entry);
  }
}
export const pluginLifecycle = new PluginLifecycle(pluginRuntime);
