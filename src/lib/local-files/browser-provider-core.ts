import type { BrowserDirectoryHost, BrowserDirectoryProvider } from "./browser-contract";
import { MAX_SOURCE_BYTES } from "./file-model";
import type { LocalFileListOptions } from "./tree";

/** One read/preview/compare implementation for every application host. */
export function createBrowserDirectoryProvider(host: BrowserDirectoryHost): BrowserDirectoryProvider {
  const check = (signal: AbortSignal) => { signal.throwIfAborted(); host.assertActive(); };
  return {
    digestByteLimit: () => host.files.digestByteLimit(),
    async contentDigest(rootId: string, node: string, signal: AbortSignal, binary = false) {
      check(signal);
      if (binary) { const result = await host.files.digest(rootId, node); check(signal); return result; }
      const before = await host.files.stat(rootId, node);
      check(signal);
      if (before.size > MAX_SOURCE_BYTES) throw new Error("正文比较单文件最多 4 MiB");
      const snapshot = await host.files.readSnapshot(rootId, node);
      check(signal);
      const after = await host.files.stat(rootId, node);
      check(signal);
      if (before.size !== snapshot.size || before.modifiedMs !== snapshot.modifiedMs || before.size !== after.size || before.modifiedMs !== after.modifiedMs) throw new Error("正文读取期间文件已变化");
      return { ...after, digest: snapshot.revision };
    },
    async preview(rootId: string, node: string, signal: AbortSignal): Promise<{ kind: "text" | "image"; value: string; truncated: boolean }> {
      check(signal);
      const image = /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(node);
      const fingerprint = await host.files.stat(rootId, node);
      check(signal);
      if (fingerprint.size > (image ? 8 : 1) * 1024 * 1024) throw new Error(`快速预览最多读取 ${image ? 8 : 1} MiB；可直接打开文件`);
      const value = image ? await host.files.readImageAsset(rootId, node) : (await host.files.readSnapshot(rootId, node)).source;
      check(signal);
      return { kind: image ? "image" : "text", value: image ? value : value.slice(0, 65536), truncated: !image && value.length > 65536 };
    },
    async page(rootId: string, node: string, offset: number, options: LocalFileListOptions, signal: AbortSignal) {
      check(signal);
      const page = await host.files.list(rootId, node, offset, options);
      check(signal);
      return page;
    },
    async properties(rootId: string, node: string, signal: AbortSignal) {
      check(signal);
      const value = await host.files.stat(rootId, node);
      check(signal);
      return value;
    },
    async open(rootId, rootName, node, signal, location) {
      check(signal);
      await host.open({ rootId, rootName, node, ...(location ? { location } : {}) }, signal);
    },
  };
}
