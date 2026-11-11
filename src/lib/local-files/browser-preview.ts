import type { FileNode, LocalFileFingerprint } from "./file-model";

export interface PreviewMatch { from: number; to: number }
/** Literal Unicode search; never run user-supplied regex or derive offsets from
 * a case-folded copy (case folding can change the UTF-16 string length). */
export function browserPreviewMatches(source: string, query: string, matchCase = false) {
  const matches: PreviewMatch[] = [];
  if (!query) return { matches, limited: false };
  const literal = Array.from(query, char => "\\u{" + char.codePointAt(0)!.toString(16) + "}").join("");
  const pattern = new RegExp(literal, matchCase ? "gu" : "giu");
  for (const result of source.matchAll(pattern)) {
    if (matches.length === 1000) return { matches, limited: true };
    matches.push({ from: result.index, to: result.index + result[0].length });
  }
  return { matches, limited: false };
}
/** Continuous quick preview visits files in the current loaded/sorted/filtered
 * list only. Do not silently enter folders or wrap to another authorized root. */
export function browserPreviewIndex(nodes: readonly FileNode[], current: string | undefined, direction: -1 | 1): number | null {
  let at = nodes.findIndex(node => node.id === current);
  if (at < 0) at = direction === 1 ? -1 : nodes.length;
  for (at += direction; at >= 0 && at < nodes.length; at += direction) if (!nodes[at].directory) return at;
  return null;
}
export function browserSelectionSummary(nodes: readonly FileNode[], selected: readonly string[], metadata: Readonly<Record<string, LocalFileFingerprint>>) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  let bytes = 0, files = 0, directories = 0, unknown = 0;
  for (const id of new Set(selected)) {
    const node = byId.get(id);
    if (!node) { unknown++; continue; }
    if (node.directory) { directories++; continue; }
    const size = metadata[id]?.size ?? (node.modifiedMs !== undefined ? node.size : undefined);
    if (size === undefined || size < 0 || !Number.isSafeInteger(size) || !Number.isSafeInteger(bytes + size)) { unknown++; continue; }
    bytes += size; files++;
  }
  return { bytes, files, directories, unknown };
}
export interface BrowserPreviewNavigation { step: (direction: -1 | 1) => boolean }

/** Only preview-owned object URLs are released; data/remote text assets remain untouched. */
export function releaseBrowserPreview(preview: { kind: "image" | "text"; value: string } | null) {
  if (preview?.kind === "image" && preview.value.startsWith("blob:")) URL.revokeObjectURL(preview.value);
}
