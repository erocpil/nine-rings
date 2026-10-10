export type PluginErrorCode =
  | "PLUGIN_DISABLED"
  | "PERMISSION_DENIED"
  | "READ_ONLY"
  | "STALE_TARGET"
  | "STALE_REVISION"
  | "INVALID_ARGUMENT"
  | "UNSUPPORTED_PLATFORM"
  | "UNSUPPORTED_VIEW"
  | "TIMEOUT"
  | "CANCELLED"
  | "DUPLICATE_REQUEST"
  | "COMMAND_NOT_FOUND"
  | "SAVE_FAILED"
  | "INTERNAL_ERROR";
export class PluginHostError extends Error {
  constructor(
    readonly code: PluginErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export type PluginPermission =
  "editor.selection.read" | "editor.selection.write" | "documents.current.read";
export interface PluginActivation {
  readonly pluginId: string;
  readonly generation: string;
}
export interface PluginRuntimeStatus {
  enabled: boolean;
  activations: readonly {
    pluginId: string;
    generation: string;
    permissions: readonly PluginPermission[];
    resources: number;
  }[];
  cleanupFailures: number;
}
interface ActivationState {
  token: PluginActivation;
  controller: AbortController;
  permissions: ReadonlySet<PluginPermission>;
  resources: Set<() => void>;
}

/** Only the host issues activations. Copying a serialized descriptor is not authority. */
export class PluginRuntime {
  private enabled = false;
  private cleanupFailures = 0;
  private status: PluginRuntimeStatus = Object.freeze({
    enabled: false,
    activations: [],
    cleanupFailures: 0,
  });
  getStatus = () => this.status;
  private changed() {
    this.status = Object.freeze({
      enabled: this.enabled,
      cleanupFailures: this.cleanupFailures,
      activations: Object.freeze(
        [...this.activations.values()].map((state) =>
          Object.freeze({
            pluginId: state.token.pluginId,
            generation: state.token.generation,
            permissions: Object.freeze([...state.permissions].sort()),
            resources: state.resources.size,
          }),
        ),
      ),
    });
    for (const listener of this.listeners) listener();
  }
  private activations = new Map<string, ActivationState>();
  private issued = new WeakMap<PluginActivation, ActivationState>();
  private listeners = new Set<() => void>();
  isEnabled = () => this.enabled;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled)
      for (const id of [...this.activations.keys()]) this.deactivate(id);
    this.changed();
  }
  activate(
    pluginId: string,
    permissions: readonly PluginPermission[],
  ): PluginActivation {
    if (!this.enabled)
      throw new PluginHostError("PLUGIN_DISABLED", "插件功能已关闭");
    if (
      !/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(pluginId) ||
      pluginId.length > 64
    )
      throw new PluginHostError("INVALID_ARGUMENT", "插件身份无效");
    const allowed = new Set<PluginPermission>([
      "editor.selection.read",
      "editor.selection.write",
      "documents.current.read",
    ]);
    if (permissions.some((permission) => !allowed.has(permission)))
      throw new PluginHostError("PERMISSION_DENIED", "插件能力尚未开放");
    this.deactivate(pluginId);
    const token = Object.freeze({ pluginId, generation: crypto.randomUUID() });
    const state = {
      token,
      controller: new AbortController(),
      permissions: new Set(permissions),
      resources: new Set<() => void>(),
    };
    this.activations.set(pluginId, state);
    this.issued.set(token, state);
    this.changed();
    return token;
  }
  deactivate(pluginId: string): void {
    const state = this.activations.get(pluginId);
    this.activations.delete(pluginId);
    state?.controller.abort();
    // Reverse acquisition order; a failing cleanup must not strand other resources.
    for (const dispose of [...(state?.resources ?? [])].reverse()) dispose();
    if (state) this.changed();
  }
  own(activation: PluginActivation, cleanup: () => void): () => void {
    this.assert(activation);
    const state = this.issued.get(activation)!;
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      state.resources.delete(dispose);
      try {
        cleanup();
      } catch {
        this.cleanupFailures += 1;
      }
      this.changed();
    };
    state.resources.add(dispose);
    this.changed();
    return dispose;
  }

  assert(
    activation: PluginActivation,
    permission?: PluginPermission,
  ): AbortSignal {
    const state = this.issued.get(activation);
    if (
      !this.enabled ||
      !state ||
      this.activations.get(activation.pluginId) !== state ||
      state.controller.signal.aborted
    )
      throw new PluginHostError(
        "PLUGIN_DISABLED",
        "插件已停用或激活身份已失效",
      );
    if (permission && !state.permissions.has(permission))
      throw new PluginHostError("PERMISSION_DENIED", "插件未获得此项能力");
    return state.controller.signal;
  }
  permissions(activation: PluginActivation): readonly PluginPermission[] {
    this.assert(activation);
    return Object.freeze([...this.issued.get(activation)!.permissions].sort());
  }
}
export const PLUGINS_ENABLED_KEY = "nr:pluginsEnabled";
function readPreference(): boolean {
  try {
    return localStorage.getItem(PLUGINS_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}
export const pluginRuntime = new PluginRuntime();
export function setPluginsEnabled(enabled: boolean): void {
  // Disable immediately even if persistence fails; enabling requires a saved preference.
  if (!enabled) pluginRuntime.setEnabled(false);
  localStorage.setItem(PLUGINS_ENABLED_KEY, String(enabled));
  pluginRuntime.setEnabled(enabled);
}
export function startPluginRuntime(): () => void {
  pluginRuntime.setEnabled(readPreference());
  const changed = (event: StorageEvent) => {
    if (event.key === PLUGINS_ENABLED_KEY || event.key === null)
      pluginRuntime.setEnabled(readPreference());
  };
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener("storage", changed);
    pluginRuntime.setEnabled(false);
  };
}
