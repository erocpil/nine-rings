import { fileSegments } from "./file-model";
/** Canonical root paths come only from the host. Case-fold conservatively to
 * avoid missing aliases on case-insensitive volumes; do not resolve symlinks. */
export function protectedPathsOverlap(left: string, right: string) {
  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase("en-US");
  const a = normalize(left), b = normalize(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
export function parseDraftPath(identity: string) {
  const colon = identity.indexOf(":");
  if (colon <= 0) throw new Error("恢复草稿身份无法核验，请先处理草稿");
  const rootId = identity.slice(0, colon), node = identity.slice(colon + 1);
  if (!fileSegments(node).length) throw new Error("恢复草稿路径无法核验，请先处理草稿");
  return { rootId, node };
}
export function canonicalChildPath(root: string, node: string) {
  fileSegments(node);
  if (!root.startsWith("/") && !root.startsWith("\\\\") && !/^[a-z]:[\\/]/i.test(root)) throw new Error("无法确定授权目录的完整路径");
  return `${root.replace(/[\\/]+$/, "")}/${node}`;
}
