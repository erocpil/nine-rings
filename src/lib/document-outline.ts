import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface DocumentOutlineItem {
  level: number;
  text: string;
  /** Heading 节点在 ProseMirror 文档中的起始位置。 */
  pos: number;
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
