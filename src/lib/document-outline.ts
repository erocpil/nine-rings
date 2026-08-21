import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface DocumentOutlineItem {
  level: number;
  text: string;
  /** Heading 节点在 ProseMirror 文档中的起始位置。 */
  pos: number;
}

/**
 * 返回文档位置所属的目录项：标题本身及其后内容都归属该标题，直到
 * 下一个标题开始。位置早于首个标题时仍定位到首项，便于打开目录。
 */
export function documentOutlineIndexAtPosition(
  items: DocumentOutlineItem[],
  position: number,
): number {
  if (items.length === 0) return -1;
  let activeIndex = 0;
  for (let index = 1; index < items.length; index++) {
    if (items[index].pos > position) break;
    activeIndex = index;
  }
  return activeIndex;
}

/** 从已渲染的结构化文档中提取 H1–H6，不修改或回写正文。 */
export function extractDocumentOutline(doc: ProseMirrorNode): DocumentOutlineItem[] {
  const items: DocumentOutlineItem[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    const level = Number(node.attrs.level);
    if (!Number.isInteger(level) || level < 1 || level > 6) return;
    items.push({
      level,
      text: node.textContent.trim() || "未命名标题",
      pos,
    });
  });
  return items;
}
