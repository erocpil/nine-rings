import type { DocumentOutlineItem } from "./document-outline";
import type { SourceSymbol } from "./source-symbols";
import { sourceSymbolSortName } from "./source-symbol-sort";
export interface VisibleOutlineEntry {
  item: DocumentOutlineItem;
  /** 在完整目录中的索引，用于当前章节定位。 */
  index: number;
  folded: boolean;
  foldable: boolean;
}

export type SourceOutlineItem = DocumentOutlineItem & {
  offset: number;
  sortName?: string;
};
const symbols: Record<SourceSymbol["kind"], string> = {
  命名空间: "◇",
  类型: "{}",
  别名: "T",
  函数: "ƒ",
  变量: "v",
  成员: "·",
  枚举值: "e",
  宏: "#",
};
export function sourceOutlineItems(
  items: readonly SourceSymbol[],
): SourceOutlineItem[] {
  return items.map((item) => ({
    ...item,
    offset: item.pos,
    kindSymbol: symbols[item.kind],
    displayText: item.displayText ?? item.text,
    sortName: sourceSymbolSortName(item.identity, item.kind, item.text),
  }));
}

/** Folding changes only a projection. Hosts may key folds by stable semantic
 * identity (files) or source position (a navigation revision). */
export function outlineVisibleEntries<T extends DocumentOutlineItem>(
  items: readonly T[],
  folded: (item: T) => boolean,
): VisibleOutlineEntry[] {
  let hiddenBelow = Infinity;
  return items.flatMap((item, index) => {
    if (item.level > hiddenBelow) return [];
    const collapsed = folded(item);
    hiddenBelow = collapsed ? item.level : Infinity;
    return [
      {
        item,
        index,
        folded: collapsed,
        foldable: (items[index + 1]?.level ?? 0) > item.level,
      },
    ];
  });
}
