import { strToU8, zip, type Zippable } from "fflate";
import type { Note } from "../types/models";
import { api } from "./api";
import { getDocumentFolderPath } from "./move-to";
import { noteToMarkdown } from "./markdown-serializer";
import { isTauri, exportZipWithDialog } from "./tauri-desktop";

export interface PathExportDocument {
  folder: string;
  note: Note;
}

/** Portable names, including Windows device names and ZIP traversal prevention. */
export function safeExportName(value: string): string {
  const name =
    value
      .normalize("NFC")
      .split("")
      .map((character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
          ? "-"
          : character,
      )
      .join("")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/^[. ]+|[. ]+$/g, "")
      .slice(0, 100)
      .replace(/[. ]+$/g, "") || "无标题";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
    ? `_${name}`
    : name;
}

/** Reserve directory names before filenames; never overwrite colliding names. */
export function buildPathMarkdownFiles(
  path: string,
  documents: PathExportDocument[],
): Zippable {
  if (
    !path ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("无效的导出路径");
  if (!documents.length) throw new Error("此路径下没有可导出的文档");
  const files = Object.create(null) as Zippable;
  const used = new Map<string, Set<string>>();
  const allocate = (parent: string, name: string, extension = "") => {
    const names = used.get(parent) ?? new Set<string>();
    used.set(parent, names);
    let candidate = `${name}${extension}`;
    let index = 2;
    while (names.has(candidate.toLowerCase()))
      candidate = `${name} (${index++})${extension}`;
    names.add(candidate.toLowerCase());
    return parent ? `${parent}/${candidate}` : candidate;
  };
  const root = safeExportName(path.split("/").pop()!);
  const folders = new Map([[path, root]]);
  const ensureFolder = (folder: string): string => {
    const known = folders.get(folder);
    if (known) return known;
    const slash = folder.lastIndexOf("/");
    const target = allocate(
      ensureFolder(folder.slice(0, slash)),
      safeExportName(folder.slice(slash + 1)),
    );
    folders.set(folder, target);
    return target;
  };
  for (const { folder, note } of documents) {
    if (folder !== path && !folder.startsWith(`${path}/`))
      throw new Error("文档已移出所选路径，请重试");
    if (
      folder.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("文档路径无效");
    if (note.content.encrypted)
      throw new Error(
        `包含加密文档「${note.title || note.id}」，请先打开该文档并使用编辑器单独导出；本次未导出任何文件`,
      );
    ensureFolder(folder);
  }
  for (const { folder, note } of documents) {
    const title = (note.title?.trim() || "无标题").replace(
      /\.(md|txt|markdown)$/i,
      "",
    );
    const filename = allocate(
      folders.get(folder)!,
      safeExportName(title),
      ".md",
    );
    const markdown =
      note.content.metadata?.markdownSource ??
      noteToMarkdown(note.title, note.content);
    files[filename] = strToU8(markdown);
  }
  return files;
}

export async function exportPathMarkdown(
  path: string,
  onProgress: (message: string) => void,
): Promise<number | null> {
  const nodes = (await api.docs.tree(true)).filter(
    (node) =>
      node.type === "document" &&
      node.noteId &&
      node.path.startsWith(`${path}/`),
  );
  if (!nodes.length) throw new Error("此路径下没有可导出的文档");
  const documents: PathExportDocument[] = [];
  for (const node of nodes) {
    onProgress(`正在读取文档 ${documents.length + 1}/${nodes.length}`);
    const note = await api.notes.get(node.noteId!);
    if (!note || note.deleted_at)
      throw new Error("文档已删除，请刷新后重试；本次未导出任何文件");
    const folder = note.storagePath || `daily/${note.date}`;
    if (folder !== getDocumentFolderPath(node.path, note.id))
      throw new Error("文档路径已变化，请重试");
    documents.push({ folder, note });
  }
  onProgress(`正在打包 ${documents.length} 篇文档…`);
  const files = buildPathMarkdownFiles(path, documents);
  const data = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (error, result) =>
      error ? reject(error) : resolve(result),
    );
  });
  const filename = `${safeExportName(path.split("/").pop()!)}.zip`;
  if (isTauri()) {
    if (!(await exportZipWithDialog(data, filename))) return null;
  } else {
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(data)], { type: "application/zip" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }
  return documents.length;
}
