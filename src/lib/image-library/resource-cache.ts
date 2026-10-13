import { imagePreview, type ImagePreviewResource } from "./preview-resource";
import { imageKey } from "./session";
import type { ViewedImage } from "./viewer-request";

interface Entry {
  promise: Promise<ImagePreviewResource>;
  controller: AbortController;
  resource?: ImagePreviewResource;
  refs: number;
  cost: number;
  retired: boolean;
}
/** Bounded session LRU with shared in-flight work and individually cancellable leases. */
export class ImageResourceCache {
  private entries = new Map<string, Entry>();
  constructor(
    private load = imagePreview,
    private maxBytes = 64 * 1024 * 1024,
    private maxEntries = 192,
  ) {}
  private dispose(entry: Entry) {
    entry.retired = true;
    if (!entry.refs) {
      entry.controller.abort();
      entry.resource?.release();
      entry.resource = undefined;
    }
  }
  private trim() {
    let bytes = [...this.entries.values()].reduce(
      (sum, entry) => sum + entry.cost,
      0,
    );
    for (const [key, entry] of this.entries) {
      if (bytes <= this.maxBytes && this.entries.size <= this.maxEntries) break;
      if (entry.refs) continue;
      this.entries.delete(key);
      bytes -= entry.cost;
      this.dispose(entry);
    }
  }
  invalidate(image: ViewedImage) {
    const suffix = `:${imageKey(image)}`;
    for (const [key, entry] of this.entries) {
      if (key.endsWith(suffix)) {
        this.entries.delete(key);
        this.dispose(entry);
      }
    }
  }
  clear() {
    for (const entry of this.entries.values()) this.dispose(entry);
    this.entries.clear();
  }
  acquire(
    image: ViewedImage,
    signal: AbortSignal,
    maxEdge = 2048,
  ): Promise<ImagePreviewResource> {
    if (signal.aborted)
      return Promise.reject(new DOMException("Cancelled", "AbortError"));
    // Full originals have an unpredictable decoded size. Do not retain them.
    if (!maxEdge) return this.load(image, signal, maxEdge);
    const key = `${maxEdge}:${imageKey(image)}`;
    let entry = this.entries.get(key);
    if (!entry) {
      const controller = new AbortController();
      const pending = this.load(image, controller.signal, maxEdge);
      entry = {
        controller,
        refs: 0,
        cost: maxEdge * maxEdge * 4,
        retired: false,
        promise: pending,
      };
      const created = entry;
      created.promise = pending.then(
        (resource) => {
          created.resource = resource;
          // Missing dimensions indicate an unbounded native/browser source.
          if (!resource.width) created.cost = 32 * 1024 * 1024;
          if (created.retired && !created.refs) this.dispose(created);
          this.trim();
          return resource;
        },
        (error) => {
          if (this.entries.get(key) === created) this.entries.delete(key);
          throw error;
        },
      );
      this.entries.set(key, created);
    } else {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    const current = entry;
    current.refs++;
    return new Promise((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        current.refs--;
        if (!current.refs && !current.resource) {
          if (this.entries.get(key) === current) this.entries.delete(key);
          this.dispose(current);
        } else if (current.retired) this.dispose(current);
        this.trim();
      };
      const abort = () => {
        release();
        reject(new DOMException("Cancelled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      current.promise.then(
        (resource) => {
          signal.removeEventListener("abort", abort);
          if (!released) resolve({ ...resource, release });
        },
        (error) => {
          signal.removeEventListener("abort", abort);
          release();
          reject(error);
        },
      );
    });
  }
}
export const imageResourceCache = new ImageResourceCache();
