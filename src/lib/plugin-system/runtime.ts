export type PluginErrorCode =
  | "PLUGIN_DISABLED"
  | "PERMISSION_DENIED"
  | "READ_ONLY"
  | "STALE_TARGET"
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
interface ActivationState {
  token: PluginActivation;
  controller: AbortController;
  permissions: ReadonlySet<PluginPermission>;
}

/** Only the host issues activations. Copying a serialized descriptor is not authority. */
export class PluginRuntime {
  private enabled = false;
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
    for (const listener of this.listeners) listener();
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
    };
    this.activations.set(pluginId, state);
    this.issued.set(token, state);
    return token;
  }
  deactivate(pluginId: string): void {
    const state = this.activations.get(pluginId);
    this.activations.delete(pluginId);
    state?.controller.abort();
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
