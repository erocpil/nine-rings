/**
 * LineNumberInsert — 行号旁悬浮 "+" 按钮。
 *
 * CSS 负责显示/隐藏（hover gutter 区域出现 "+"），
 * React 负责 click 事件委托（在 NoteEditor 中处理）。
 *
 * 导出一个工厂函数，返回 mousedown handler 供组件绑定。
 */

import type { Editor } from "@tiptap/core";

/**
 * 创建行号 gutter 区域的 click 处理器。
 * 绑定到 editor 的父容器上，通过事件委托判断点击是否在 gutter 区域。
 *
 * @param editor - TipTap editor 实例
 * @returns mousedown 事件处理器
 */
export function createGutterClickHandler(editor: Editor): (e: MouseEvent) => void {
  const GUTTER_WIDTH = 36;

  return (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const editorDom = editor.view.dom;

    // 只处理 .ProseMirror 内部的点击
    if (!editorDom.contains(target)) return;

    // 获取点击位置的元素
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;

    // 向上查找最近的顶层 ProseMirror block
    let block: Element | null = el.closest(
      ".ProseMirror > p, .ProseMirror > h1, .ProseMirror > h2, .ProseMirror > h3, " +
      ".ProseMirror > h4, .ProseMirror > h5, .ProseMirror > h6, .ProseMirror > blockquote, " +
      ".ProseMirror > pre, .ProseMirror > ul, .ProseMirror > ol, .ProseMirror > .code-block-wrap"
    );
    if (!block) return;

    // 检查点击是否在 gutter 区域（block 左侧 36px 内）
    const blockRect = block.getBoundingClientRect();
    const relX = e.clientX - blockRect.left;
    if (relX < 0 || relX > GUTTER_WIDTH) return;

    // 找到该 DOM 元素在 ProseMirror doc 中的位置
    const pmView = editor.view;
    const pos = pmView.posAtDOM(block, 0);
    if (pos == null) return;

    // 获取该位置的节点信息
    const $pos = pmView.state.doc.resolve(pos);
    // 取父节点（顶层 block）的起始位置
    const blockStart = $pos.start($pos.depth);

    // 不处理第一个 block（文档开头无需插入）
    if (blockStart <= 0) return;

    // 在 block 前插入空段落
    editor
      .chain()
      .insertContentAt(blockStart, { type: "paragraph" })
      .focus()
      .run();
  };
}
