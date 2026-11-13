import type { FileNode } from "../../lib/local-files/file-model";
/** Snapshot of the current sorted/filtered directory; never enters a folder or
 * enumerates additional directories to move between full-view previews. */
export function workbenchPreviewFiles(nodes: readonly FileNode[]) {
  return nodes.filter(node => !node.directory && (/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?|heic|heif|pdf)$/i.test(node.name) || (!/\.(pdf|epub|zip|gz|tar|7z|rar|o|a|so|dll|exe|wasm|mp[34]|mov|avi|ttf|woff2?|dmg|iso)$/i.test(node.name) && node.size <= 4 * 1024 * 1024)));
}
export function nextWorkbenchPreview(nodes: readonly FileNode[], current: string, direction: -1 | 1) {
  const allowed = new Set(workbenchPreviewFiles(nodes).map(node => node.id));
  const index = nodes.findIndex(node => node.id === current);
  if (index < 0) return undefined;
  for (let at = index + direction; at >= 0 && at < nodes.length; at += direction) if (allowed.has(nodes[at].id)) return nodes[at];
}
