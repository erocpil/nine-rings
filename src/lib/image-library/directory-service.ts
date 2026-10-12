import { isTauriRuntime } from "../runtime";
import { workspacePanels } from "../plugin-system/panel-registry";
export interface ImageRoot {
  id: string;
  name: string;
  transient?: boolean;
}
export interface ImageNode {
  id: string;
  name: string;
  directory: boolean;
  size: number;
  modified: number;
}
export interface ImagePage {
  nodes: ImageNode[];
  next: number | null;
}
interface DirectoryHandle {
  kind: "directory";
  name: string;
  values(): AsyncIterable<DirectoryHandle | ImageFileHandle>;
  getDirectoryHandle(name: string): Promise<DirectoryHandle>;
  getFileHandle(name: string): Promise<ImageFileHandle>;
  queryPermission(options: { mode: "read" }): Promise<string>;
  requestPermission(options: { mode: "read" }): Promise<string>;
}
interface ImageFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
};
export const imageMime = (name: string) =>
  MIME[name.split(".").pop()?.toLowerCase() ?? ""];
export function imageSegments(path: string): string[] {
  if (!path) return [];
  const parts = path.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[\\:]/.test(part) ||
        part.includes(String.fromCharCode(0)),
    )
  )
    throw new Error("无效的图片路径");
  return parts;
}
async function native<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
const browserRoots = new Map<
  string,
  { root: ImageRoot; handle?: DirectoryHandle; files?: Map<string, File> }
>();
function handlesDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("nine-rings-image-library", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("roots", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function savedRoots(
  operation: "read" | "put" | "delete",
  value?: unknown,
): Promise<unknown[]> {
  const db = await handlesDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        "roots",
        operation === "read" ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("roots");
      const request =
        operation === "read"
          ? store.getAll()
          : operation === "put"
            ? store.put(value)
            : store.delete(String(value));
      let result: unknown[] = [];
      request.onsuccess = () => {
        if (operation === "read") result = request.result as unknown[];
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
let generation = 0;
const assert = () => workspacePanels.assert("images");
export const imageDirectoryService = {
  async roots(): Promise<ImageRoot[]> {
    const owner = assert();
    if (isTauriRuntime()) {
      const result = await native<ImageRoot[]>("image_library_roots");
      if (assert() !== owner) throw new Error("图片插件已换代");
      return [
        ...result,
        ...[...browserRoots.values()].map((entry) => entry.root),
      ];
    }
    const stored = await savedRoots("read");
    if (assert() !== owner) throw new Error("图片插件已换代");
    for (const raw of stored) {
      const record = raw as ImageRoot & { handle: DirectoryHandle };
      if (record.handle?.kind === "directory" && !browserRoots.has(record.id))
        browserRoots.set(record.id, {
          root: { id: record.id, name: record.name },
          handle: record.handle,
        });
    }
    return [...browserRoots.values()].map((entry) => entry.root);
  },
  supportsDirectoryPicker() {
    return isTauriRuntime() || "showDirectoryPicker" in window;
  },
  async choose(): Promise<ImageRoot | null> {
    const owner = assert();
    if (isTauriRuntime()) {
      const root = await native<ImageRoot | null>("image_library_choose");
      if (assert() !== owner) throw new Error("图片插件已换代");
      return root;
    }
    const picker = (
      window as unknown as {
        showDirectoryPicker: (options: {
          mode: string;
        }) => Promise<DirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (!picker) throw new Error("当前浏览器请使用选择图片目录或选择图片文件");
    let handle: DirectoryHandle;
    try {
      handle = await picker.call(window, { mode: "read" });
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return null;
      throw error;
    }
    if (assert() !== owner) throw new Error("图片插件已换代");
    const root = { id: crypto.randomUUID(), name: handle.name };
    await savedRoots("put", { ...root, handle });
    if (assert() !== owner) throw new Error("图片插件已换代");
    browserRoots.set(root.id, { root, handle });
    return root;
  },
  addFiles(files: readonly File[]): ImageRoot | null {
    assert();
    if (!files.length) return null;
    if (files.length > 5000)
      throw new Error("一次最多选择 5000 个文件，请选择更具体的目录");
    const valid = files.filter((file) => imageMime(file.name));
    if (!valid.length) throw new Error("没有支持的图片文件");
    const name = valid[0].webkitRelativePath?.split("/")[0] || "已选择图片";
    const root: ImageRoot = { id: crypto.randomUUID(), name, transient: true };
    const entries = new Map<string, File>();
    for (const file of valid) {
      const path = file.webkitRelativePath
        ? file.webkitRelativePath.split("/").slice(1).join("/")
        : file.name;
      imageSegments(path);
      if (entries.has(path))
        throw new Error("选择的图片存在同名路径，请分别选择目录");
      entries.set(path, file);
    }
    browserRoots.set(root.id, { root, files: entries });
    return root;
  },
  async remove(id: string) {
    assert();
    generation++;
    if (browserRoots.get(id)?.files) browserRoots.delete(id);
    else if (isTauriRuntime())
      await native("image_library_remove", { rootId: id });
    else {
      await savedRoots("delete", id);
      browserRoots.delete(id);
    }
  },
  async list(rootId: string, path = "", offset = 0): Promise<ImagePage> {
    const owner = assert();
    imageSegments(path);
    if (!Number.isInteger(offset) || offset < 0)
      throw new Error("无效的分页位置");
    if (isTauriRuntime() && !browserRoots.has(rootId)) {
      const result = await native<ImagePage>("image_library_list", {
        rootId,
        node: path,
        offset,
      });
      if (assert() !== owner) throw new Error("图片插件已换代");
      return result;
    }
    const entry = browserRoots.get(rootId);
    if (!entry) throw new Error("请重新选择图片目录");
    const nodes: ImageNode[] = [];
    if (entry.handle) {
      if (
        (await entry.handle.queryPermission({ mode: "read" })) !== "granted" &&
        (await entry.handle.requestPermission({ mode: "read" })) !== "granted"
      )
        throw new Error("目录读取未授权，请重新授权");
      let directory = entry.handle;
      for (const part of imageSegments(path))
        directory = await directory.getDirectoryHandle(part);
      let scanned = 0;
      for await (const child of directory.values()) {
        if (++scanned > 10000)
          throw new Error("单目录超过 10000 项，请选择更具体的子目录");
        if (child.kind === "file" && !imageMime(child.name)) continue;
        imageSegments(child.name);
        nodes.push({
          id: path ? `${path}/${child.name}` : child.name,
          name: child.name,
          directory: child.kind === "directory",
          size: 0,
          modified: 0,
        });
      }
    } else {
      const prefix = path ? path + "/" : "";
      const seen = new Set<string>();
      for (const [relative, file] of entry.files ?? []) {
        if (!relative.startsWith(prefix)) continue;
        const tail = relative.slice(prefix.length);
        const name = tail.split("/")[0];
        if (seen.has(name)) continue;
        seen.add(name);
        nodes.push({
          id: prefix + name,
          name,
          directory: tail.includes("/"),
          size: tail.includes("/") ? 0 : file.size,
          modified: file.lastModified,
        });
      }
    }
    if (assert() !== owner) throw new Error("图片插件已换代");
    nodes.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name),
    );
    return {
      nodes: nodes.slice(offset, offset + 200),
      next: offset + 200 < nodes.length ? offset + 200 : null,
    };
  },
  async read(rootId: string, path: string): Promise<Blob> {
    const owner = assert();
    const version = generation;
    imageSegments(path);
    const type = imageMime(path);
    if (!type) throw new Error("不支持的图片格式");
    let blob: Blob;
    if (isTauriRuntime() && !browserRoots.has(rootId)) {
      const bytes = await native<number[]>("image_library_read", {
        rootId,
        node: path,
      });
      blob = new Blob([new Uint8Array(bytes)], { type });
    } else {
      const entry = browserRoots.get(rootId);
      if (!entry) throw new Error("目录授权已撤销");
      if (entry.handle) {
        let directory = entry.handle;
        const parts = imageSegments(path);
        for (const part of parts.slice(0, -1))
          directory = await directory.getDirectoryHandle(part);
        blob = await (
          await directory.getFileHandle(parts[parts.length - 1])
        ).getFile();
      } else {
        const file = entry.files?.get(path);
        if (!file) throw new Error("图片不可访问");
        blob = file;
      }
    }
    if (assert() !== owner) throw new Error("图片插件已换代");
    if (!blob.size || blob.size > 10 * 1024 * 1024)
      throw new Error("图片为空或超过 10 MB");
    const bytes = await blob.arrayBuffer();
    if (assert() !== owner || version !== generation)
      throw new Error("图片授权已变更");
    return new Blob([bytes], { type });
  },
  async stat(
    rootId: string,
    path: string,
  ): Promise<{ size: number; modified?: number; created?: number }> {
    const owner = assert();
    const version = generation;
    imageSegments(path);
    if (!imageMime(path)) throw new Error("不支持的图片格式");
    let result: { size: number; modified?: number; created?: number };
    if (isTauriRuntime() && !browserRoots.has(rootId))
      result = await native("image_library_stat", { rootId, node: path });
    else {
      const entry = browserRoots.get(rootId);
      if (!entry) throw new Error("目录授权已撤销");
      let file = entry.files?.get(path);
      if (entry.handle) {
        let directory = entry.handle;
        const parts = imageSegments(path);
        for (const part of parts.slice(0, -1))
          directory = await directory.getDirectoryHandle(part);
        file = await (
          await directory.getFileHandle(parts[parts.length - 1])
        ).getFile();
      }
      if (!file) throw new Error("图片不可访问");
      result = { size: file.size, modified: file.lastModified };
    }
    if (assert() !== owner || version !== generation)
      throw new Error("图片授权已变更");
    return result;
  },
  release() {
    generation++;
    browserRoots.clear();
  },
};
