import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface DocumentOutlineItem {
  level: number;
  text: string;
  /** Heading 节点在 ProseMirror 文档中的起始位置。 */
  pos: number;
}

const outlineCache = new WeakMap<ProseMirrorNode, DocumentOutlineItem[]>();

/**
 * 返回文档位置所属的目录项：标题本身及其后内容都归属该标题，直到
 * 下一个标题开始。位置早于首个标题时仍定位到首项，便于打开目录。
 */
export function documentOutlineIndexAtPosition(
  items: DocumentOutlineItem[],
  position: number,
): number {
  if (items.length === 0) return -1;
  // 目录可包含数千个标题；打开时用二分定位当前章节，避免每次都从头扫描。
  let low = 0;
  let high = items.length - 1;
  let activeIndex = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (items[middle].pos <= position) {
      activeIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return activeIndex;
}

/** 从已渲染的结构化文档中提取 H1–H6，不修改或回写正文。 */
export function extractDocumentOutline(doc: ProseMirrorNode): DocumentOutlineItem[] {
  const cached = outlineCache.get(doc);
  if (cached) return cached;
  const items: DocumentOutlineItem[] = [];
  // 标题在当前 schema 中都是顶层块；不进入段落、表格或代码块的子树。
  doc.forEach((node, pos) => {
    if (node.type.name !== "heading") return;
    const level = Number(node.attrs.level);
    if (!Number.isInteger(level) || level < 1 || level > 6) return;
    items.push({
      level,
      text: node.textContent.trim() || "未命名标题",
      pos,
    });
  });
  outlineCache.set(doc, items);
  return items;
}
