/**
 * LineNumberInsert — 行间插入。

 * CSS 在两处显示 "+"：
 *   1. ::before — hover 行号区域时切换为 "+"（在该 block 之前插入）
 *   2. ::after  — 每个 block 底部 gutter 区域显示淡色 "+"（在该 block 之后插入）

 * JS mousedown handler 通过 Y 坐标判断用户点击的是上方（前插）还是下方（后插）。

 * Gutter 采用 parent-based 架构（参考 CodeMirror 6）：
 *   - gutter 宽度放在 .ProseMirror 的 padding-left 上
 *   - "+" 伪元素用 position:absolute + left:-Npx 回拉到 gutter
 *   - 所以 relX（相对 block 左沿）为负值
 */

import type { Editor } from "@tiptap/core";

/** 底部 "+" 区域高度（px，从 block 底部往上算，需与 CSS padding-bottom 对齐） */
const PLUS_ZONE = 10;

/** 计算当前模式下的 gutter 宽度 */
function getGutterWidth(editorDom: HTMLElement): number {
  const showLineNumbers = editorDom.classList.contains("show-line-numbers");
  const focusMode = !!editorDom.closest(".focus-mode");
  if (focusMode && showLineNumbers) return 36;
  if (showLineNumbers) return 44;
  return 14;
}

export function createGutterClickHandler(editor: Editor): (e: MouseEvent) => void {
  return (e: MouseEvent) => {
    const editorDom = editor.view.dom;
    if (!editorDom.contains(e.target as HTMLElement)) return;

    const clickedEl = document.elementFromPoint(e.clientX, e.clientY);
    if (!clickedEl) return;

    const block = clickedEl.closest(
      ".ProseMirror > p, .ProseMirror > h1, .ProseMirror > h2, .ProseMirror > h3, " +
      ".ProseMirror > h4, .ProseMirror > h5, .ProseMirror > h6, .ProseMirror > blockquote, " +
      ".ProseMirror > pre, .ProseMirror > ul, .ProseMirror > ol, .ProseMirror > .code-block-wrap"
    );
    if (!block) return;

    const gutterWidth = getGutterWidth(editorDom);

    const blockRect = block.getBoundingClientRect();
    const relX = e.clientX - blockRect.left;
    // "+" 在 block 左侧 gutter 区（CSS left: -gutterWidth），relX 为负值
    if (relX >= -gutterWidth && relX < 0) {
      // inside gutter — proceed
    } else {
      return;
    }

    // 找到 block 在 ProseMirror doc 中的位置
    const pmView = editor.view;
    let blockPos: number | null = null;
    pmView.state.doc.descendants((_node, pos) => {
      if (blockPos !== null) return false;
      if (pmView.nodeDOM(pos) === block) {
        blockPos = pos;
        return false;
      }
      return true;
    });
    if (blockPos === null) return;

    // 判断点击区域：行号区（上方）还是行间 "+" 区（底部）
    const relFromBottom = blockRect.bottom - e.clientY;

    if (relFromBottom >= 0 && relFromBottom <= PLUS_ZONE) {
      // ── 底部 "+" 区 → 在当前 block 之后插入 ──
      const $pos = pmView.state.doc.resolve(blockPos);
      const node = $pos.nodeAfter;
      if (!node) return;
      const insertPos = blockPos + node.nodeSize;
      if (insertPos > pmView.state.doc.content.size) return;

      editor
        .chain()
        .insertContentAt(insertPos, { type: "paragraph" })
        .focus()
        .run();
    } else {
      // ── 行号区 → 在当前 block 之前插入 ──
      if (blockPos <= 1) return;

      editor
        .chain()
        .insertContentAt(blockPos, { type: "paragraph" })
        .focus()
        .run();
    }
  };
}
