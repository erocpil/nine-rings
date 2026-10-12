import {
  pluginRuntime,
  PluginHostError,
  type PluginActivation,
  type PluginRuntime,
} from "./runtime";
/** Declarative slot, never a plugin-supplied React component or DOM callback. */
export interface WorkspacePanelContribution {
  id: "images";
  label: string;
  icon: "image";
  renderer: "image-library";
}
export class WorkspacePanelRegistry {
  private entries = new Map<
    string,
    { owner: PluginActivation; value: Readonly<WorkspacePanelContribution> }
  >();
  private listeners = new Set<() => void>();
  private snapshot: readonly Readonly<WorkspacePanelContribution>[] =
    Object.freeze([]);
  constructor(private runtime: PluginRuntime) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private changed() {
    this.snapshot = Object.freeze(
      [...this.entries.values()].map((entry) => entry.value),
    );
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* isolate observers */
      }
    }
  }
  register(owner: PluginActivation, value: WorkspacePanelContribution) {
    this.runtime.assert(owner, "panels.present");
    if (
      value.id !== "images" ||
      value.renderer !== "image-library" ||
      value.icon !== "image" ||
      !value.label.trim() ||
      value.label.length > 32 ||
      Object.keys(value).some(
        (key) => !["id", "label", "icon", "renderer"].includes(key),
      )
    )
      throw new PluginHostError("INVALID_ARGUMENT", "分栏贡献无效");
    if (this.entries.has(value.id))
      throw new PluginHostError("INVALID_ARGUMENT", "分栏已注册");
    const entry = { owner, value: Object.freeze({ ...value }) };
    this.entries.set(value.id, entry);
    this.runtime.own(owner, () => {
      if (this.entries.get(value.id) === entry) {
        this.entries.delete(value.id);
        this.changed();
      }
    });
    this.changed();
  }
  assert(id: string) {
    const entry = this.entries.get(id);
    if (!entry)
      throw new PluginHostError("PLUGIN_DISABLED", "图片查看插件未启用");
    this.runtime.assert(entry.owner, "filesystem.images.read");
    return entry.owner;
  }
}
export const workspacePanels = new WorkspacePanelRegistry(pluginRuntime);
