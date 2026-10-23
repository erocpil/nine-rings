import { clearLocalFileSessions } from "./session";
import { isTauriRuntime } from "../runtime";
import { workspacePanels } from "../plugin-system/panel-registry";

export interface FileRoot {
  id: string;
  name: string;
  transient?: boolean;
}
export interface FileNode {
  id: string;
  name: string;
  directory: boolean;
  size: number;
}
export interface FilePage {
  nodes: FileNode[];
  next: number | null;
}
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export function fileSegments(path: string): string[] {
  if (!path) return [];
  const parts = path.split("/");
  if (
    parts.some(
      (part) => !part || part === "." || part === ".." || /[\\:\0]/.test(part),
    )
  )
    throw new Error("无效的文件路径");
  return parts;
}
export function decodeSource(bytes: Uint8Array): string {
  if (bytes.length > MAX_SOURCE_BYTES)
    throw new Error("只读源码入口最多打开 4 MiB 文件");
  // Fatal decoding prevents binary/non-UTF-8 data from silently becoming replacement characters.
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("文件不是有效的 UTF-8 文本");
  }
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (code === 127 || (code < 32 && ![9, 10, 11, 12, 13].includes(code)))
      throw new Error("这是二进制或不支持的文本文件");
  }
  return source;
}
interface FileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}
interface DirectoryHandle {
  kind: "directory";
  name: string;
  values(): AsyncIterable<DirectoryHandle | FileHandle>;
  getDirectoryHandle(name: string): Promise<DirectoryHandle>;
  getFileHandle(name: string): Promise<FileHandle>;
}
const roots = new Map<
  string,
  { root: FileRoot; handle?: DirectoryHandle; files?: Map<string, File> }
>();
let generation = 0;
const assert = () => workspacePanels.assert("files");
async function native<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
function guard() {
  const owner = assert(),
    version = generation;
  return () => {
    if (assert() !== owner || generation !== version)
      throw new Error("文件目录授权已变化，请重新打开");
  };
}
export const localFileService = {
  supportsDirectoryPicker: () =>
    isTauriRuntime() ||
    typeof (window as unknown as { showDirectoryPicker?: unknown })
      .showDirectoryPicker === "function",
  async roots(): Promise<FileRoot[]> {
    const check = guard();
    const result = isTauriRuntime()
      ? await native<FileRoot[]>("local_files_roots")
      : [...roots.values()].map((entry) => entry.root);
    check();
    return result;
  },
  async choose(): Promise<FileRoot | null> {
    const check = guard();
    if (isTauriRuntime()) {
      const root = await native<FileRoot | null>("local_files_choose");
      check();
      return root;
    }
    const picker = (
      window as unknown as {
        showDirectoryPicker?: (options: {
          mode: "read";
        }) => Promise<DirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (!picker) throw new Error("当前浏览器不支持目录授权，请选择目录快照");
    let handle: DirectoryHandle;
    try {
      handle = await picker.call(window, { mode: "read" });
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return null;
      throw error;
    }
    check();
    const root: FileRoot = {
      id: crypto.randomUUID(),
      name: handle.name,
      transient: true,
    };
    roots.set(root.id, { root, handle });
    return root;
  },
  addFiles(files: readonly File[]): FileRoot | null {
    assert();
    if (!files.length) return null;
    if (files.length > 10000)
      throw new Error("目录快照最多 10000 个文件，请选择更具体的目录");
    const entries = new Map<string, File>();
    const name = files[0].webkitRelativePath?.split("/")[0] || "所选文件";
    for (const file of files) {
      const path = file.webkitRelativePath
        ? file.webkitRelativePath.split("/").slice(1).join("/")
        : file.name;
      fileSegments(path);
      if (entries.has(path)) throw new Error("目录快照存在重复路径");
      entries.set(path, file);
    }
    const root: FileRoot = { id: crypto.randomUUID(), name, transient: true };
    roots.set(root.id, { root, files: entries });
    return root;
  },
  async remove(rootId: string) {
    const check = guard();
    if (isTauriRuntime()) await native("local_files_remove", { rootId });
    check();
    generation++;
    roots.delete(rootId);
    clearLocalFileSessions(rootId);
  },
  async list(rootId: string, node = "", offset = 0): Promise<FilePage> {
    const check = guard();
    fileSegments(node);
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new Error("无效的分页位置");
    if (isTauriRuntime()) {
      const page = await native<FilePage>("local_files_list", {
        rootId,
        node,
        offset,
      });
      check();
      return page;
    }
    const entry = roots.get(rootId);
    if (!entry) throw new Error("目录授权已失效，请重新选择目录");
    const nodes = new Map<string, FileNode>();
    if (entry.handle) {
      let dir = entry.handle;
      for (const part of fileSegments(node))
        dir = await dir.getDirectoryHandle(part);
      let count = 0;
      for await (const child of dir.values()) {
        if (++count > 10000)
          throw new Error("单目录超过 10000 项，请选择更具体的目录");
        fileSegments(child.name);
        nodes.set(child.name, {
          id: node ? `${node}/${child.name}` : child.name,
          name: child.name,
          directory: child.kind === "directory",
          size: 0,
        });
      }
    } else {
      const prefix = node ? node + "/" : "";
      for (const [path, file] of entry.files ?? []) {
        if (!path.startsWith(prefix)) continue;
        const tail = path.slice(prefix.length),
          name = tail.split("/")[0];
        nodes.set(name, {
          id: prefix + name,
          name,
          directory: tail.includes("/"),
          size: file.size,
        });
      }
    }
    check();
    const sorted = [...nodes.values()].sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name),
    );
    return {
      nodes: sorted.slice(offset, offset + 200),
      next: offset + 200 < sorted.length ? offset + 200 : null,
    };
  },
  async read(rootId: string, node: string): Promise<string> {
    const check = guard();
    if (!fileSegments(node).length) throw new Error("请选择文件");
    let bytes: Uint8Array;
    if (isTauriRuntime()) {
      const result = await native<ArrayBuffer | number[]>("local_files_read", {
        rootId,
        node,
      });
      check();
      bytes = new Uint8Array(result);
    } else {
      const entry = roots.get(rootId);
      if (!entry) throw new Error("目录授权已失效");
      let file = entry.files?.get(node);
      if (entry.handle) {
        let dir = entry.handle;
        const parts = fileSegments(node);
        for (const part of parts.slice(0, -1))
          dir = await dir.getDirectoryHandle(part);
        file = await (
          await dir.getFileHandle(parts[parts.length - 1])
        ).getFile();
      }
      if (!file) throw new Error("文件已移动或不可访问");
      if (file.size > MAX_SOURCE_BYTES)
        throw new Error("只读源码入口最多打开 4 MiB 文件");
      bytes = new Uint8Array(await file.arrayBuffer());
    }
    check();
    return decodeSource(bytes);
  },
  release() {
    generation++;
    roots.clear();
  },
};
