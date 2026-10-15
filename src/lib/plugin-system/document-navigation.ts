import {
  pluginRuntime,
  PluginHostError,
  type PluginActivation,
  type PluginRuntime,
} from "./runtime";

/** Scope is a provider-owned identity: a disk path, document path or virtual group. */
export interface NavigationDocument {
  id: string;
  title: string;
  scope: string;
}
export function adjacentDocuments(
  items: readonly NavigationDocument[],
  currentId: string,
) {
  const current = items.find((item) => item.id === currentId);
  const siblings = current
    ? items.filter((item) => item.scope === current.scope)
    : [];
  const index = siblings.findIndex((item) => item.id === currentId);
  return {
    previous: index > 0 ? siblings[index - 1] : null,
    next: index >= 0 ? (siblings[index + 1] ?? null) : null,
  };
}
export type DocumentNeighbors = ReturnType<typeof adjacentDocuments>;
/** Trusted host adapters only; plugins do not receive storage or React access. */
export class DocumentNavigationRegistry {
  private entries = new Map<
    string,
    {
      owner: PluginActivation;
      list: () => Promise<NavigationDocument[]>;
      open: (id: string, current: string) => Promise<void>;
    }
  >();
  constructor(private runtime: PluginRuntime) {}
  register(
    owner: PluginActivation,
    id: string,
    provider: {
      list: () => Promise<NavigationDocument[]>;
      open: (id: string, current: string) => Promise<void>;
    },
  ) {
    this.runtime.assert(owner, "views.present");
    if (this.entries.has(id))
      throw new PluginHostError("INVALID_ARGUMENT", "导航提供者已注册");
    const entry = { owner, ...provider };
    this.entries.set(id, entry);
    this.runtime.own(owner, () => {
      if (this.entries.get(id) === entry) this.entries.delete(id);
    });
  }
  private entry(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new PluginHostError("PLUGIN_DISABLED", "导航插件未启用");
    this.runtime.assert(entry.owner, "views.present");
    return entry;
  }
  async neighbors(
    provider: string,
    current: string,
  ): Promise<DocumentNeighbors> {
    const entry = this.entry(provider);
    const items = await entry.list();
    if (this.entry(provider) !== entry)
      throw new PluginHostError("STALE_TARGET", "导航插件已重新加载");
    return adjacentDocuments(items, current);
  }
  async openAdjacent(provider: string, current: string, targetId: string) {
    const entry = this.entry(provider);
    const neighbors = await this.neighbors(provider, current);
    if (this.entry(provider) !== entry)
      throw new PluginHostError("STALE_TARGET", "导航插件已重新加载");
    if (![neighbors.previous?.id, neighbors.next?.id].includes(targetId))
      throw new PluginHostError("STALE_TARGET", "导航目标已变化");
    await entry.open(targetId, current);
  }
}
export const documentNavigation = new DocumentNavigationRegistry(pluginRuntime);
