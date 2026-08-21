import { assertFolderRelocation, normalizeStoragePath, PARA_TOP_DIRS } from "./storage/core";

export type MoveToSubject =
  | {
      kind: "document";
      noteId: string;
      title: string;
      currentPath: string;
    }
  | {
      kind: "folder";
      sourcePath: string;
      documentCount?: number;
    };

/** 文档树中的文档节点 path 末尾是 noteId，而不是 storagePath。 */
export function getDocumentFolderPath(nodePath: string, noteId: string): string {
  const suffix = `/${noteId}`;
  return nodePath.endsWith(suffix)
    ? nodePath.slice(0, -suffix.length)
    : nodePath.split("/").slice(0, -1).join("/");
}

/**
 * 文档选择目标目录；目录选择目标父目录，并自动保留原目录名。
 * 空父目录表示把目录移动到文档树根级。
 */
export function resolveMoveTarget(subject: MoveToSubject, destinationInput: string): string {
  if (subject.kind === "document") {
    const target = normalizeStoragePath(destinationInput);
    if (target === normalizeStoragePath(subject.currentPath)) {
      throw new Error("文档已经位于该目录");
    }
    return target;
  }

  const source = normalizeStoragePath(subject.sourcePath);
  const folderName = source.split("/").pop()!;
  const rawParent = destinationInput.trim().replace(/^\/+|\/+$/g, "");
  const target = rawParent
    ? `${normalizeStoragePath(rawParent)}/${folderName}`
    : folderName;
  return assertFolderRelocation(source, target).target;
}

/** 目录选择器固定提供 P.A.R.A. 顶层目录，同时合并数据库中的自定义目录。 */
export function collectMoveFolderPaths(paths: Iterable<string>): string[] {
  const unique = new Set<string>(PARA_TOP_DIRS);
  for (const path of paths) {
    try {
      unique.add(normalizeStoragePath(path));
    } catch {
      // daily 虚拟目录及损坏的旧路径不应成为移动目标。
    }
  }
  return [...unique].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function getPathAncestors(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

