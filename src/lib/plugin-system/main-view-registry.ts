import { isVocabularyResource, type VocabularyResourceRef } from "../vocabulary/contracts";
import {
  pluginRuntime,
  PluginHostError,
  type PluginActivation,
  type PluginRuntime,
} from "./runtime";
import type { ViewedImage } from "../image-library/viewer-request";

/** Host-rendered declarations only. Extending renderer types requires a host implementation. */
export interface MainViewContribution {
  id: string;
  label: string;
  renderer: "image" | "vocabulary" | "local-file" | "file-browser";
}
export interface FileBrowserViewData { rootId?: string }
export interface ImageViewData {
  image: ViewedImage;
  images: readonly ViewedImage[];
}
export interface LocalFileViewData {
  rootId: string;
  nodeId: string;
  name: string;
  location?: { from: number; to: number; revision: string };
}
export interface VocabularyViewData {
  resource?: VocabularyResourceRef;
  documentId: string;
  title: string;
  source: string;
}
interface RequestBase {
  readonly id: number;
  readonly owner: PluginActivation;
  readonly view: Readonly<MainViewContribution>;
}
export type MainViewRequest = RequestBase &
  (
    | { readonly renderer: "file-browser"; readonly data: Readonly<FileBrowserViewData> }
    | { readonly renderer: "local-file"; readonly data: Readonly<LocalFileViewData> }
    | { readonly renderer: "image"; readonly data: Readonly<ImageViewData> }
    | {
        readonly renderer: "vocabulary";
        readonly data: Readonly<VocabularyViewData>;
      }
  );
interface Snapshot {
  readonly browser: Extract<MainViewRequest, { renderer: "file-browser" }> | null;
  readonly current: MainViewRequest | null;
  readonly pending: MainViewRequest | null;
  readonly suspended: boolean;
}
function imageValue(value: ViewedImage): Readonly<ViewedImage> {
  if (
    !value ||
    typeof value.src !== "string" ||
    typeof value.name !== "string" ||
    value.src.length > 15_000_000 ||
    value.name.length > 4096 ||
    Object.keys(value).some(
      (key) => !["src", "name", "rootId", "nodeId"].includes(key),
    ) ||
    (value.rootId !== undefined &&
      (typeof value.rootId !== "string" ||
        !value.rootId ||
        typeof value.nodeId !== "string" ||
        !value.nodeId)) ||
    (value.nodeId !== undefined && !value.rootId)
  )
    throw new PluginHostError("INVALID_ARGUMENT", "无效的图片视图资源");
  return Object.freeze({ ...value });
}
export class MainViewRegistry {
  private contributions = new Map<
    string,
    { owner: PluginActivation; view: Readonly<MainViewContribution> }
  >();
  private listeners = new Set<() => void>();
  private sequence = 0;
  private snapshot: Snapshot = Object.freeze({
    browser: null,
    current: null,
    pending: null,
    suspended: false,
  });
  constructor(private runtime: PluginRuntime) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private publish(patch: Partial<Snapshot>) {
    if (
      Object.entries(patch).every(
        ([key, value]) => this.snapshot[key as keyof Snapshot] === value,
      )
    )
      return;
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* isolate observers */
      }
    }
  }
  register(owner: PluginActivation, declaration: MainViewContribution) {
    this.runtime.assert(owner, "views.present");
    if (
      !declaration ||
      typeof declaration.id !== "string" ||
      typeof declaration.label !== "string" ||
      !/^[a-z][a-z0-9.-]{0,95}$/.test(declaration.id) ||
      !declaration.label?.trim() ||
      declaration.label.length > 32 ||
      !(["image", "vocabulary", "local-file", "file-browser"] as string[]).includes(declaration.renderer) ||
      Object.keys(declaration).some(
        (key) => !["id", "label", "renderer"].includes(key),
      ) ||
      this.contributions.has(declaration.id)
    )
      throw new PluginHostError("INVALID_ARGUMENT", "主区域视图贡献无效");
    const entry = { owner, view: Object.freeze({ ...declaration }) };
    this.contributions.set(declaration.id, entry);
    this.runtime.own(owner, () => {
      if (this.contributions.get(declaration.id) !== entry) return;
      this.contributions.delete(declaration.id);
      const { current, pending } = this.snapshot;
      this.publish({
        browser: this.snapshot.browser?.owner === owner ? null : this.snapshot.browser,
        current: current?.owner === owner ? null : current,
        pending: pending?.owner === owner ? null : pending,
      });
    });
  }
  open(
    owner: PluginActivation,
    id: string,
    data: ImageViewData | VocabularyViewData | LocalFileViewData | FileBrowserViewData,
  ): number {
    this.runtime.assert(owner, "views.present");
    const contribution = this.contributions.get(id);
    if (!contribution || contribution.owner !== owner)
      throw new PluginHostError(
        "PERMISSION_DENIED",
        "视图未注册或不属于当前插件",
      );
    let request: MainViewRequest;
    if (contribution.view.renderer === "file-browser") {
      this.runtime.assert(owner, "filesystem.files.read");
      const value = data as FileBrowserViewData;
      if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).some(key => key !== "rootId") ||
        (value.rootId !== undefined && (typeof value.rootId !== "string" || !value.rootId || value.rootId.length > 4096)))
        throw new PluginHostError("INVALID_ARGUMENT", "目录浏览身份无效");
      request = Object.freeze({ id: ++this.sequence, owner, view: contribution.view, renderer: "file-browser", data: Object.freeze({ ...value }) });
    } else if (contribution.view.renderer === "local-file") {
      this.runtime.assert(owner, "filesystem.files.read");
      const value = data as LocalFileViewData;
      if (!value || Object.keys(value).some(key => !["rootId", "nodeId", "name", "location"].includes(key)) ||
        [value.rootId, value.nodeId, value.name].some(item => typeof item !== "string" || !item || item.length > 4096) ||
        value.nodeId.split("/").some(part => !part || part === "." || part === ".." || /[\\:\0]/.test(part)))
        throw new PluginHostError("INVALID_ARGUMENT", "本地文件身份无效");
      if (value.location !== undefined && (!value.location || typeof value.location !== "object" || Object.keys(value.location).some(key => !["from", "to", "revision"].includes(key)) || !Number.isSafeInteger(value.location.from) || value.location.from < 0 || !Number.isSafeInteger(value.location.to) || value.location.to < value.location.from || !/^[a-f0-9]{64}$/.test(value.location.revision)))
        throw new PluginHostError("INVALID_ARGUMENT", "本地搜索位置无效");
      request = Object.freeze({ id: ++this.sequence, owner, view: contribution.view, renderer: "local-file", data: Object.freeze({ ...value, ...(value.location ? { location: Object.freeze({ ...value.location }) } : {}) }) });
    } else if (contribution.view.renderer === "vocabulary") {
      this.runtime.assert(owner, "documents.vocabulary.read");
      const value = data as VocabularyViewData;
      if (
        !value ||
        Object.keys(value).some(
          (key) => !["documentId", "title", "source", "resource"].includes(key),
        ) ||
        typeof value.documentId !== "string" ||
        !value.documentId ||
        value.documentId.length > 128 ||
        typeof value.title !== "string" ||
        value.title.length > 4096 ||
        typeof value.source !== "string" ||
        value.source.length > 250000 ||
        (value.resource !== undefined && !isVocabularyResource(value.resource, value.documentId))
      )
        throw new PluginHostError("INVALID_ARGUMENT", "词汇视图数据无效或超限");
      request = Object.freeze({
        id: ++this.sequence,
        owner,
        view: contribution.view,
        renderer: "vocabulary",
        data: Object.freeze({ ...value, ...(value.resource ? { resource: Object.freeze({ ...value.resource }) } : {}) }),
      });
    } else {
      const value = data as ImageViewData;
      if (
        !value ||
        Object.keys(value).some((key) => !["image", "images"].includes(key)) ||
        !Array.isArray(value.images) ||
        !value.images.length ||
        value.images.length > 5000
      )
        throw new PluginHostError("INVALID_ARGUMENT", "无效的图片集合");
      const image = imageValue(value.image);
      const images = Object.freeze(value.images.map(imageValue));
      if ([image, ...images].some((item) => item.rootId))
        this.runtime.assert(owner, "filesystem.images.read");
      request = Object.freeze({
        id: ++this.sequence,
        owner,
        view: contribution.view,
        renderer: "image",
        data: Object.freeze({ image, images }),
      });
    }
    this.publish({ pending: request });
    return request.id;
  }
  /** Activation-bound plugin facade. Acceptance and workspace suspension remain host-only. */
  bind(owner: PluginActivation) {
    this.runtime.assert(owner, "views.present");
    return Object.freeze({
      register: (view: MainViewContribution) => this.register(owner, view),
      open: (id: string, data: ImageViewData | VocabularyViewData | LocalFileViewData | FileBrowserViewData) =>
        this.open(owner, id, data),
      close: (id: number) => {
        this.runtime.assert(owner, "views.present");
        const request = [this.snapshot.current, this.snapshot.pending].find(
          (value) => value?.id === id,
        );
        if (!request) return;
        if (request.owner !== owner)
          throw new PluginHostError(
            "PERMISSION_DENIED",
            "不能关闭其它插件的视图",
          );
        if (this.snapshot.current?.id === id)
          this.close(id);
        if (this.snapshot.pending?.id === id) this.reject(id);
      },
    });
  }
  /** Host-only identity migration after a confirmed disk operation. */
  relocateLocalFile(actor: PluginActivation, rootId: string, node: string, targetRootId: string, targetNode: string) {
    this.runtime.assert(actor, "filesystem.files.write");
    const relocate = (request: MainViewRequest | null): MainViewRequest | null => {
      if (request?.renderer !== "local-file" || request.data.rootId !== rootId || !(request.data.nodeId === node || request.data.nodeId.startsWith(`${node}/`))) return request;
      const nodeId = targetNode + request.data.nodeId.slice(node.length);
      return Object.freeze({ ...request, data: Object.freeze({ ...request.data, rootId: targetRootId, nodeId, name: nodeId.split("/").pop()! }) });
    };
    // Host relocation is not a new navigation request: preserve suspension,
    // request IDs and any unrelated pending destination/save gate.
    this.publish({ current: relocate(this.snapshot.current), pending: relocate(this.snapshot.pending) });
  }
  /** Host accepts only after saving. A stale/disabled request cannot replace the workspace. */
  accept(id: number) {
    const pending = this.snapshot.pending;
    if (!pending || pending.id !== id) return false;
    this.runtime.assert(pending.owner, "views.present");
    if (pending.renderer === "local-file" || pending.renderer === "file-browser") this.runtime.assert(pending.owner, "filesystem.files.read");
    if (pending.renderer === "vocabulary")
      this.runtime.assert(pending.owner, "documents.vocabulary.read");
    const browser = pending.renderer === "file-browser" ? pending
      : (pending.renderer === "local-file" || pending.renderer === "image") && this.snapshot.browser?.owner === pending.owner ? this.snapshot.browser : null;
    this.publish({ current: pending, browser, pending: null, suspended: false });
    return true;
  }
  reject(id: number) {
    if (this.snapshot.pending?.id === id) this.publish({ pending: null });
  }
  close(id?: number) {
    if (
      id !== undefined &&
      this.snapshot.current?.id !== id &&
      this.snapshot.pending?.id !== id
    )
      return;
    const browser = this.snapshot.browser;
    // Explicit viewer return re-enters the normal host save gate. Unscoped
    // workspace navigation closes the entire browser session instead.
    if (id !== undefined && this.snapshot.current?.id === id && browser && browser.id !== id) {
      this.runtime.assert(browser.owner, "views.present");
      this.publish({ pending: browser });
    } else this.publish({ current: null, browser: null, pending: null, suspended: false });
  }
  suspend() {
    if (this.snapshot.current) this.publish({ suspended: true });
    this.cancelPending();
  }
  resume() {
    if (this.snapshot.current && this.snapshot.suspended)
      this.publish({ suspended: false });
  }
  private cancelPending() {
    if (this.snapshot.pending) this.publish({ pending: null });
  }
}
export const mainViews = new MainViewRegistry(pluginRuntime);
