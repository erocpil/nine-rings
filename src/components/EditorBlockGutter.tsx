import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";

interface GutterBlock {
  index: number;
  pos: number;
  endPos: number;
  top: number;
  bottom: number;
  marginBottom: number;
  active: boolean;
}

interface EditorBlockGutterProps {
  editor: Editor;
  showNumbers: boolean;
  readonly: boolean;
  onBlockCountChange?: (count: number) => void;
}

/**
 * 与 ProseMirror 文档位置绑定的块级 gutter。
 *
 * 编号和插入按钮都是真实 DOM，不再借用伪元素或根据鼠标坐标猜测
 * 用户意图。ResizeObserver 会在窗口、侧栏或字体导致重排时重新测量。
 */
export function EditorBlockGutter({ editor, showNumbers, readonly, onBlockCountChange }: EditorBlockGutterProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [blocks, setBlocks] = useState<GutterBlock[]>([]);

  const measure = useCallback(() => {
    frameRef.current = null;
    const root = rootRef.current;
    if (!root || editor.isDestroyed) return;

    const rootRect = root.getBoundingClientRect();
    const next: GutterBlock[] = [];
    const selectionPos = editor.state.selection.from;
    editor.state.doc.forEach((node, pos, index) => {
      const dom = editor.view.nodeDOM(pos);
      if (!(dom instanceof HTMLElement)) return;
      const rect = dom.getBoundingClientRect();
      next.push({
        index: index + 1,
        pos,
        endPos: pos + node.nodeSize,
        top: rect.top - rootRect.top,
        bottom: rect.bottom - rootRect.top,
        marginBottom: index === editor.state.doc.childCount - 1
          ? Math.max(0, Number.parseFloat(getComputedStyle(dom).marginBottom) || 0)
          : 0,
        active: selectionPos >= pos && selectionPos < pos + node.nodeSize,
      });
    });
    setBlocks(next);
    onBlockCountChange?.(next.length);
  }, [editor, onBlockCountChange]);

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(measure);
  }, [measure]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(root);
    observer.observe(editor.view.dom);
    editor.on("transaction", scheduleMeasure);
    window.addEventListener("resize", scheduleMeasure);
    scheduleMeasure();

    return () => {
      editor.off("transaction", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [editor, scheduleMeasure]);

  const insertParagraph = (pos: number) => {
    const safePos = Math.min(Math.max(0, pos), editor.state.doc.content.size);
    editor
      .chain()
      .insertContentAt(safePos, { type: "paragraph" })
      .focus(safePos + 1)
      .scrollIntoView()
      .run();
  };

  const boundaries = blocks.length === 0
    ? []
    : [
        { key: "start", pos: blocks[0].pos, top: blocks[0].top, label: "在第一块前插入段落" },
        ...blocks.map((block, index) => {
          const nextBlock = blocks[index + 1];
          const gap = nextBlock
            ? Math.max(0, nextBlock.top - block.bottom)
            : block.marginBottom;
          return {
            key: `after-${block.pos}`,
            pos: block.endPos,
            // DOMRect 不包含 margin。将按钮放在相邻块之间的视觉空隙中央，
            // 避免 horizontalRule 的“块后插入”按钮贴到分割线上方。
            top: block.bottom + gap / 2,
            label: `在第 ${block.index} 块后插入段落`,
          };
        }),
      ];

  return (
    <div ref={rootRef} className="editor-block-gutter" aria-hidden={readonly && !showNumbers}>
      {showNumbers && blocks.map((block) => (
        <span
          key={`number-${block.pos}`}
          className={`editor-block-number ${block.active ? "active" : ""}`}
          style={{ top: block.top }}
          aria-hidden="true"
        >
          {block.index}
        </span>
      ))}
      {!readonly && boundaries.map((boundary) => (
        <button
          key={boundary.key}
          type="button"
          className="editor-block-insert"
          style={{ top: boundary.top }}
          aria-label={boundary.label}
          title={boundary.label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => insertParagraph(boundary.pos)}
        >
          +
        </button>
      ))}
    </div>
  );
}
