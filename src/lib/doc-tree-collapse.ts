import type { PathNode } from "../types/models";

/**
 * 返回“折叠其它目录”操作后应折叠的目录路径。
 * 当前文档/目录所在路径及其所有祖先保持展开。
 */
export function getOtherFolderPaths(
  tree: PathNode[],
  selectedId: string | null,
  selectedFolderPath: string | null,
): string[] {
  const selectedDocument = selectedId
    ? tree.find((node) => node.type === "document" && node.noteId === selectedId)
    : undefined;
  const activePath = selectedDocument?.path ?? selectedFolderPath;

  if (!activePath) {
    return tree
      .filter((node) => node.type === "folder")
      .map((node) => node.path);
  }

  const parts = activePath.split("/");
  const expandedPaths = new Set<string>();
  const activePathIsFolder = selectedFolderPath === activePath && !selectedDocument;
  const folderDepth = activePathIsFolder ? parts.length : parts.length - 1;
  for (let depth = 1; depth <= folderDepth; depth++) {
    expandedPaths.add(parts.slice(0, depth).join("/"));
  }

  return tree
    .filter((node) => node.type === "folder" && !expandedPaths.has(node.path))
    .map((node) => node.path);
}
