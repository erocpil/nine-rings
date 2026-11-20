import { sourceAnchorMapping, type SourceEditRange } from "../markdown-source-navigation";

export function remapLocalFileBookmarks<T>(
  items: T[], before: string, after: string,
  move: (item: T, mapOffset: (offset: number) => number) => T,
  range?: SourceEditRange,
): T[] {
  if (!items.length || before === after) return items;
  const map = sourceAnchorMapping(before, after, range);
  const mapOffset = (offset: number) => Math.max(0, Math.min(after.length, map(offset)));
  return items.map(item => move(item, mapOffset));
}
