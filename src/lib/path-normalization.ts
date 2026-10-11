import { normalizeStoragePath, isPathUnder } from "./storage/core";

export interface PathNormalizationCollision { canonicalPath: string; paths: string[] }

/** Comparison only: never changes case or spelling of a persisted path. */
export function pathNormalizationCollisions(paths: string[]): PathNormalizationCollision[] {
  const groups = new Map<string, Set<string>>();
  for (const path of paths) {
    const parts = normalizeStoragePath(path).split("/");
    for (let depth = 1; depth <= parts.length; depth++) {
      const prefix = parts.slice(0, depth).join("/");
      const key = prefix.normalize("NFC");
      const group = groups.get(key) ?? new Set<string>();
      group.add(prefix);
      groups.set(key, group);
    }
  }
  return [...groups].filter(([, paths]) => paths.size > 1)
    .map(([canonicalPath, paths]) => ({ canonicalPath, paths: [...paths].sort() }))
    .sort((a, b) => a.canonicalPath < b.canonicalPath ? -1 : 1);
}

export function assertNoPathNormalizationCollision(target: string, existing: string[], excludedSource?: string) {
  const paths = existing.filter(path => !excludedSource || !isPathUnder(path, excludedSource));
  const conflicts = pathNormalizationCollisions([...paths, target]);
  const targetPrefixes = new Set(target.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/").normalize("NFC")));
  const conflict = conflicts.find(item => targetPrefixes.has(item.canonicalPath));
  if (conflict) throw new Error(`目录 Unicode 名称冲突：${conflict.paths.join(" / ")}。请先检查并明确重命名，不能自动合并。`);
}
