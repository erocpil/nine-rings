import { checkpointLocalFilePath, clearLocalFileSessions } from "./session";
import { isTauriRuntime } from "../runtime";
import { workspacePanels } from "../plugin-system/panel-registry";
import { pluginRuntime } from "../plugin-system/runtime";
import { clearLocalFileAccessRules, isLocalFileReadOnly } from "./access";
import { DEFAULT_LOCAL_FILE_LIST, localFileTreeNodes, type LocalFileListOptions } from "./tree";

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
export interface LocalFileSnapshot {
  source: string;
  revision: string;
  bom: boolean;
  lineEnding: "lf" | "crlf" | "cr" | "mixed";
  modifiedMs: number;
  size: number;
}
export interface LocalFileFingerprint {
  modifiedMs: number;
  size: number;
}
export type SaveAsResult = "saved" | "cancelled" | "unsupported";
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
export function resolveRelativeNode(fromNode: string, href: string): string {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(href)) throw new Error("链接不在本地授权目录内");
  const pathname = decodeURIComponent(href.split(/[?#]/, 1)[0] ?? "");
  const parts = fromNode.split("/").slice(0, -1);
  for (const part of pathname.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) throw new Error("相对资源超出授权目录"); parts.pop(); }
    else parts.push(part);
  }
  const result = parts.join("/");
  fileSegments(result);
  return result;
}
export function decodeSource(bytes: Uint8Array): string {
  if (bytes.length > MAX_SOURCE_BYTES)
    throw new Error("本地文件最多打开 4 MiB");
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
  createWritable?(): Promise<{ write(data: string): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
  queryPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
  move?(destination: DirectoryHandle | string, name?: string): Promise<void>;
}
interface DirectoryHandle {
  kind: "directory";
  name: string;
  values(): AsyncIterable<DirectoryHandle | FileHandle>;
  getDirectoryHandle(name: string, options?: { create: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options?: { create: boolean }): Promise<FileHandle>;
  queryPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
  move?(destination: DirectoryHandle | string, name?: string): Promise<void>;
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
async function requestWritePermission(handle: DirectoryHandle, check: () => void) {
  let permission = await handle.queryPermission?.({ mode: "readwrite" });
  if (permission !== "granted") permission = await handle.requestPermission?.({ mode: "readwrite" });
  check();
  if (permission !== "granted") throw new Error("浏览器未授予目录写入权限");
}
export const localFileService = {
  supportsDirectoryPicker: () =>
    isTauriRuntime() ||
    typeof (window as unknown as { showDirectoryPicker?: unknown })
      .showDirectoryPicker === "function",
  supportsSaveAs: () => isTauriRuntime() || typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function",
  canSaveOriginal: (rootId: string) => isTauriRuntime() || Boolean(roots.get(rootId)?.handle),
  supportsDirectoryChanges: (rootId: string) => isTauriRuntime() || Boolean(roots.get(rootId)?.handle),
  canRename: (rootId: string) => isTauriRuntime() || Boolean(roots.get(rootId)?.handle),
  canTrash: () => isTauriRuntime(),
  async create(rootId: string, parent: string, requestedName: string, directory: boolean): Promise<string> {
    const check = guard();
    pluginRuntime.assert(workspacePanels.assert("files"), "filesystem.files.write");
    const name = requestedName.trim();
    if (fileSegments(name).length !== 1) throw new Error("请输入单个文件或目录名称");
    fileSegments(parent);
    if (isLocalFileReadOnly(rootId, parent)) throw new Error("此目录被设置为只读");
    if (isTauriRuntime()) {
      const result = await native<string>("local_files_create", { rootId, parent, name, directory });
      check(); return result;
    }
    const root = roots.get(rootId)?.handle;
    if (!root) throw new Error("目录快照不能新建文件，请授权原目录");
    await requestWritePermission(root, check);
    let destination = root;
    for (const part of fileSegments(parent)) destination = await destination.getDirectoryHandle(part);
    // File System Access has no exclusive-create primitive; do not write or truncate an existing file.
    for await (const child of destination.values()) if (child.name === name) throw new Error("目标名称已存在，未覆盖");
    check();
    if (directory) await destination.getDirectoryHandle(name, { create: true });
    else await destination.getFileHandle(name, { create: true });
    check(); return parent ? `${parent}/${name}` : name;
  },
  async move(rootId: string, node: string, parent: string, requestedName: string): Promise<string> {
    const check = guard();
    pluginRuntime.assert(workspacePanels.assert("files"), "filesystem.files.write");
    const name = requestedName.trim();
    if (fileSegments(name).length !== 1 || !fileSegments(node).length) throw new Error("不能移动授权根目录或使用无效名称");
    fileSegments(parent);
    if (parent === node || parent.startsWith(`${node}/`)) throw new Error("不能移动到自身或其子目录");
    if (isLocalFileReadOnly(rootId, node) || isLocalFileReadOnly(rootId, parent)) throw new Error("来源或目标被设置为只读");
    if (isTauriRuntime()) {
      const result = await native<string>("local_files_move", { rootId, node, parent, name });
      check(); return result;
    }
    const root = roots.get(rootId)?.handle;
    if (!root) throw new Error("目录快照不能移动文件，请授权原目录");
    await requestWritePermission(root, check);
    let destination = root;
    for (const part of fileSegments(parent)) destination = await destination.getDirectoryHandle(part);
    let sourceParent = root;
    const parts = fileSegments(node);
    for (const part of parts.slice(0, -1)) sourceParent = await sourceParent.getDirectoryHandle(part);
    let child: DirectoryHandle | FileHandle;
    try { child = await sourceParent.getDirectoryHandle(parts[parts.length - 1]!); }
    catch { child = await sourceParent.getFileHandle(parts[parts.length - 1]!); }
    if (!child.move) throw new Error("当前浏览器不支持安全移动；请使用系统文件管理器");
    for await (const entry of destination.values()) if (entry.name === name) throw new Error("目标名称已存在，未覆盖");
    check(); await child.move(destination, name); check();
    return parent ? `${parent}/${name}` : name;
  },
  async trash(rootId: string, node: string): Promise<void> {
    const check = guard();
    pluginRuntime.assert(workspacePanels.assert("files"), "filesystem.files.write");
    if (!fileSegments(node).length) throw new Error("不能删除授权根目录");
    if (isLocalFileReadOnly(rootId, node)) throw new Error("此路径被设置为只读");
    if (!isTauriRuntime()) throw new Error("浏览器不支持系统回收站，请使用系统文件管理器");
    await native("local_files_trash", { rootId, node }); check();
  },
  async roots(): Promise<FileRoot[]> {
    const check = guard();
    const result = isTauriRuntime()
      ? await native<FileRoot[]>("local_files_roots")
      : [...roots.values()].map((entry) => entry.root);
    check();
    return result;
  },
  async displayPath(rootId: string, node: string): Promise<string> {
    const check = guard();
    const owner = workspacePanels.assert("files");
    pluginRuntime.assert(owner, "filesystem.files.read");
    fileSegments(node);
    if (isTauriRuntime()) {
      const result = await native<string>("local_files_display_path", { rootId, node });
      check();
      return result;
    }
    const root = roots.get(rootId)?.root;
    if (!root) throw new Error("目录授权已失效");
    return [root.name, node].filter(Boolean).join("/");
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
    await checkpointLocalFilePath(rootId, "");
    check();
    if (isTauriRuntime()) await native("local_files_remove", { rootId });
    check();
    generation++;
    roots.delete(rootId);
    clearLocalFileSessions(rootId);
    clearLocalFileAccessRules(rootId);
  },
  async rename(rootId: string, node: string, requestedName: string): Promise<{ root: FileRoot; nodeId: string }> {
    const check = guard();
    const owner = workspacePanels.assert("files");
    pluginRuntime.assert(owner, "filesystem.files.write");
    if (isLocalFileReadOnly(rootId, node)) throw new Error("此路径被设置为只读");
    const name = requestedName.trim();
    if (!name || name === "." || name === ".." || /[\\/:\0]/.test(name))
      throw new Error("名称不能为空，也不能包含路径分隔符");
    fileSegments(node);
    if (isTauriRuntime()) {
      const result = await native<{ root: FileRoot; nodeId: string }>("local_files_rename", { rootId, node, name });
      check();
      return result;
    }
    const entry = roots.get(rootId);
    if (!entry) throw new Error("目录授权已失效");
    const nextNode = node ? `${node.slice(0, node.lastIndexOf("/") + 1)}${name}` : "";
    if (entry.handle) {
      let permission = await entry.handle.queryPermission?.({ mode: "readwrite" });
      if (permission !== "granted") permission = await entry.handle.requestPermission?.({ mode: "readwrite" });
      check();
      if (permission !== "granted") throw new Error("浏览器未授予目录写入权限，无法重命名");
      const parts = fileSegments(node);
      let parent = entry.handle;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
      let child: DirectoryHandle | FileHandle = entry.handle;
      if (parts.length) {
        try { child = await parent.getDirectoryHandle(parts[parts.length - 1]!); }
        catch { child = await parent.getFileHandle(parts[parts.length - 1]!); }
      }
      if (!child.move) throw new Error("当前浏览器不支持在授权目录内重命名");
      await child.move(name);
      check();
      if (!node) {
        const root = { ...entry.root, name };
        roots.set(rootId, { ...entry, root });
        return { root, nodeId: "" };
      }
      return { root: entry.root, nodeId: nextNode };
    }
    const files = entry.files;
    if (!files) throw new Error("目录授权不可用");
    const prefix = node ? `${node}/` : "";
    const moved = [...files.entries()].filter(([path]) => node ? path === node || path.startsWith(prefix) : true);
    if (!moved.length) throw new Error("目录或文件已不存在");
    const replacement = new Map(files);
    for (const [path] of moved) replacement.delete(path);
    const oldParts = node.split("/");
    const oldName = oldParts[oldParts.length - 1] || entry.root.name;
    const newPrefix = node ? `${node.slice(0, node.length - oldName.length)}${name}` : "";
    for (const [path, file] of moved) {
      const target = node ? `${newPrefix}${path.slice(node.length)}` : path;
      if (replacement.has(target)) throw new Error("同名文件或目录已存在");
      replacement.set(target, file);
    }
    const root = !node ? { ...entry.root, name } : entry.root;
    roots.set(rootId, { ...entry, root, files: replacement });
    check();
    return { root, nodeId: nextNode };
  },
  async list(rootId: string, node = "", offset = 0, options?: LocalFileListOptions): Promise<FilePage> {
    const check = guard();
    fileSegments(node);
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new Error("无效的分页位置");
    if (isTauriRuntime()) {
      const page = await native<FilePage>("local_files_list", {
        rootId,
        node,
        offset,
        ...(options ? { options } : {}),
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
    const sorted = localFileTreeNodes(nodes.values(), options ?? DEFAULT_LOCAL_FILE_LIST);
    return {
      nodes: sorted.slice(offset, offset + 200),
      next: offset + 200 < sorted.length ? offset + 200 : null,
    };
  },
  async readSnapshot(rootId: string, node: string): Promise<LocalFileSnapshot> {
    const check = guard();
    if (!fileSegments(node).length) throw new Error("请选择文件");
    let bytes: Uint8Array;
    if (isTauriRuntime()) {
      const result = await native<LocalFileSnapshot>("local_files_read", {
        rootId,
        node,
      });
      check();
      return result;
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
        throw new Error("本地文件最多打开 4 MiB");
      bytes = new Uint8Array(await file.arrayBuffer());
    }
    check();
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const content = bom ? bytes.subarray(3) : bytes;
    const sourceRaw = decodeSource(content);
    const withoutCrLf = sourceRaw.replace(/\r\n/g, "");
    const kinds = Number(sourceRaw.includes("\r\n")) + Number(withoutCrLf.includes("\n")) + Number(withoutCrLf.includes("\r"));
    const lineEnding = kinds > 1 ? "mixed" : sourceRaw.includes("\r\n") ? "crlf" : sourceRaw.includes("\r") ? "cr" : "lf";
    const source = sourceRaw.replace(/\r\n?/g, "\n");
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
    check();
    const revision = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
    let modifiedMs = 0;
    try {
      const entry = roots.get(rootId);
      if (entry?.handle) {
        let dir = entry.handle;
        const parts = fileSegments(node);
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
        modifiedMs = (await (await dir.getFileHandle(parts[parts.length - 1]!)).getFile()).lastModified;
      } else modifiedMs = entry?.files?.get(node)?.lastModified ?? 0;
    } catch { /* file may disappear between the read and its timestamp */ }
    return { source, revision, bom, lineEnding, modifiedMs, size: bytes.byteLength };
  },
  async stat(rootId: string, node: string): Promise<LocalFileFingerprint> {
    const check = guard(); fileSegments(node);
    if (isTauriRuntime()) {
      const result = await native<LocalFileFingerprint>("local_files_stat", { rootId, node });
      check(); return result;
    }
    const entry = roots.get(rootId); if (!entry) throw new Error("目录授权已失效");
    let file = entry.files?.get(node);
    if (entry.handle) {
      let dir = entry.handle; const parts = fileSegments(node);
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      file = await (await dir.getFileHandle(parts[parts.length - 1]!)).getFile();
    }
    if (!file) throw new Error("文件已移动或不可访问");
    check(); return { size: file.size, modifiedMs: file.lastModified };
  },
  async read(rootId: string, node: string): Promise<string> { return (await this.readSnapshot(rootId, node)).source; },
  async write(rootId: string, node: string, source: string, base: LocalFileSnapshot): Promise<LocalFileSnapshot> {
    const check = guard();
    if (isLocalFileReadOnly(rootId, node)) throw new Error("此本地文件当前为只读，请先切换为可编辑。");
    const owner = workspacePanels.assert("files");
    pluginRuntime.assert(owner, "filesystem.files.write");
    if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) throw new Error("文件超过 4 MiB");
    if (base.lineEnding === "mixed") throw new Error("文件包含混合换行符；为避免静默改写格式，请使用另存为副本");
    if (isTauriRuntime()) {
      const saved = await native<LocalFileSnapshot>("local_files_write", { rootId, node, source, expectedRevision: base.revision, bom: base.bom, lineEnding: base.lineEnding });
      check();
      return saved;
    }
    const entry = roots.get(rootId);
    if (!entry?.handle) throw new Error("目录快照不能保存原文件，请使用另存为");
    let permission = await entry.handle.queryPermission?.({ mode: "readwrite" });
    if (permission !== "granted") permission = await entry.handle.requestPermission?.({ mode: "readwrite" });
    check();
    if (permission !== "granted") throw new Error("浏览器未授予写入权限；可重新授权或另存为");
    let dir = entry.handle;
    const parts = fileSegments(node);
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1]!);
    if (!fileHandle.createWritable) throw new Error("当前浏览器不支持写入；可使用另存为");
    const currentBytes = new Uint8Array(await (await fileHandle.getFile()).arrayBuffer());
    const currentHash = await crypto.subtle.digest("SHA-256", new Uint8Array(currentBytes).buffer);
    const currentRevision = [...new Uint8Array(currentHash)].map(value => value.toString(16).padStart(2, "0")).join("");
    check();
    if (currentRevision !== base.revision) throw new Error("STALE_REVISION: 磁盘文件已被外部修改");
    const normalized = source.replace(/\r\n?/g, "\n");
    const encoded = base.lineEnding === "crlf" ? normalized.replace(/\n/g, "\r\n") : base.lineEnding === "cr" ? normalized.replace(/\n/g, "\r") : normalized;
    if (new TextEncoder().encode((base.bom ? "\ufeff" : "") + encoded).length > MAX_SOURCE_BYTES) throw new Error("按原换行格式保存后文件超过 4 MiB");
    const writable = await fileHandle.createWritable();
    const immediateBytes = new Uint8Array(await (await fileHandle.getFile()).arrayBuffer());
    const immediateDigest = await crypto.subtle.digest("SHA-256", new Uint8Array(immediateBytes).buffer);
    const immediateRevision = [...new Uint8Array(immediateDigest)].map(value => value.toString(16).padStart(2, "0")).join("");
    check();
    if (immediateRevision !== base.revision) { await writable.abort?.(); throw new Error("STALE_REVISION: 磁盘文件在保存期间被外部修改"); }
    try { await writable.write((base.bom ? "\ufeff" : "") + encoded); await writable.close(); }
    catch (error) { try { await writable.close(); } catch { /* keep original failure */ } throw error; }
    check();
    return this.readSnapshot(rootId, node);
  },
  async saveAs(name: string, source: string, base: LocalFileSnapshot | null): Promise<SaveAsResult> {
    const check = guard();
    const owner = workspacePanels.assert("files"); pluginRuntime.assert(owner, "filesystem.files.write");
    if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) throw new Error("文件超过 4 MiB");
    if (isTauriRuntime()) {
      const result = await native<boolean>("local_files_save_as", { name, source, bom: base?.bom ?? false, lineEnding: base?.lineEnding ?? "lf" });
      check(); return result ? "saved" : "cancelled";
    }
    const picker = (window as unknown as { showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<{ createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> }> }).showSaveFilePicker;
    if (!picker) return "unsupported";
    try {
      const handle = await picker.call(window, { suggestedName: name, types: [{ description: "文本文件", accept: { "text/plain": [`.${name.split(".").pop() || "txt"}`] } }] });
      const normalized = source.replace(/\r\n?/g, "\n");
      const text = (base?.lineEnding === "crlf" ? normalized.replace(/\n/g, "\r\n") : base?.lineEnding === "cr" ? normalized.replace(/\n/g, "\r") : normalized);
      if (new TextEncoder().encode((base?.bom ? "\ufeff" : "") + text).length > MAX_SOURCE_BYTES) throw new Error("另存后文件超过 4 MiB");
      const writable = await handle.createWritable();
      check();
      try { await writable.write((base?.bom ? "\ufeff" : "") + text); await writable.close(); }
      catch (error) { try { await writable.close(); } catch { /* preserve initial failure */ } throw error; }
      return "saved";
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return "cancelled";
      throw error;
    }
  },
  async readImageAsset(rootId: string, node: string): Promise<string> {
    const check = guard(); fileSegments(node);
    const extension = node.split(".").pop()?.toLowerCase();
    const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif" } as Record<string, string>)[extension ?? ""];
    if (!mime) throw new Error("不支持的图片格式");
    let bytes: Uint8Array;
    if (isTauriRuntime()) {
      const result = await native<ArrayBuffer | number[]>("local_files_read_asset", { rootId, node });
      bytes = result instanceof ArrayBuffer ? new Uint8Array(result) : new Uint8Array(result);
    } else {
      const entry = roots.get(rootId); if (!entry) throw new Error("目录授权已失效");
      let file = entry.files?.get(node);
      if (entry.handle) {
        let dir = entry.handle; const parts = fileSegments(node);
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
        file = await (await dir.getFileHandle(parts[parts.length - 1]!)).getFile();
      }
      if (!file || file.size > 20 * 1024 * 1024) throw new Error("图片不可访问或超过 20 MiB");
      bytes = new Uint8Array(await file.arrayBuffer());
    }
    check();
    let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return `data:${mime};base64,${btoa(binary)}`;
  },
  release() {
    generation++;
    roots.clear();
  },
};
