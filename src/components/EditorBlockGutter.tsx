import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { getCollapsedHeadingPositions } from "../extensions/HeadingFold";

interface GutterBlock {
  index: number;
  pos: number;
  endPos: number;
  format: string;
  top: number;
  firstLineCenter: number;
  bottom: number;
  marginBottom: number;
  active: boolean;
  heading: boolean;
  folded: boolean;
}

const HEADING_SIZE: Readonly<Record<number, number>> = {
  1: 1.6,
  2: 1.3,
  3: 1.1,
  4: 1.05,
  5: 1,
  6: 1,
};

/**
 * 找到块内第一段可见正文的首行中心。段落、标题和普通列表占绝大多数，
 * 它们直接复用编辑器行高，避免在长文档的每次输入中创建上千个 Range。
 * 只有结构复杂的块才读取首个实际文本矩形。
 */
function firstLineTextCenter(
  dom: HTMLElement,
  fallbackRect: DOMRect,
  typeName: string,
  attrs: Readonly<Record<string, unknown>>,
  editorLineHeight: number,
): number {
  if (typeName === "paragraph" || typeName === "bulletList" || typeName === "orderedList") {
    return fallbackRect.top + editorLineHeight / 2;
  }
  if (typeName === "heading") {
    const level = Number(attrs.level);
    return fallbackRect.top + editorLineHeight * (HEADING_SIZE[level] ?? 1) / 2;
  }
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent ?? "";
      const firstVisible = text.search(/\S/);
      if (firstVisible < 0) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest("button, .code-block-gutter, .column-resize-handle")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNode = walker.nextNode();
  if (textNode instanceof Text) {
    const text = textNode.textContent ?? "";
    const start = Math.max(0, text.search(/\S/));
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, Math.min(text.length, start + 1));
    const firstRect = range.getClientRects()[0];
    if (firstRect && firstRect.height > 0) return firstRect.top + firstRect.height / 2;
  }
  return fallbackRect.top + fallbackRect.height / 2;
}

function blockFormat(typeName: string, attrs: Readonly<Record<string, unknown>>): string {
  if (typeName === "heading") return `H${attrs.level ?? "?"}`;

  return {
    paragraph: "Text",
    blockquote: "Quote",
    bulletList: "UL",
    orderedList: "OL",
    taskList: "Task",
    codeBlock: "Code",
    horizontalRule: "HR",
    table: "Table",
    image: "Image",
    resizableImage: "Image",
  }[typeName] ?? "Block";
}

interface EditorBlockGutterProps {
  editor: Editor;
  showNumbers: boolean;
  showInsertButtons: boolean;
  readonly: boolean;
  onBlockCountChange?: (count: number) => void;
  onHeadingFoldToggle?: (position: number) => void;
}

/**
 * 与 ProseMirror 文档位置绑定的块级 gutter。
 *
 * 编号和插入按钮都是真实 DOM，不再借用伪元素或根据鼠标坐标猜测
 * 用户意图。ResizeObserver 会在窗口、侧栏或字体导致重排时重新测量。
 */
export function EditorBlockGutter({ editor, showNumbers, showInsertButtons, readonly, onBlockCountChange, onHeadingFoldToggle }: EditorBlockGutterProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const documentMeasureTimerRef = useRef<number | null>(null);
  const [blocks, setBlocks] = useState<GutterBlock[]>([]);

  const measure = useCallback(() => {
    frameRef.current = null;
    const root = rootRef.current;
    if (!root || editor.isDestroyed) return;

    if (!showNumbers && !showInsertButtons && !onHeadingFoldToggle) {
      // Mobile keeps insertion in the block menu. With block numbers disabled
      // there is no gutter UI at all, so avoid walking the document or reading
      // any DOM geometry on every edit.
      setBlocks((current) => current.length === 0 ? current : []);
      onBlockCountChange?.(editor.state.doc.childCount);
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const editorLineHeight = Number.parseFloat(getComputedStyle(editor.view.dom).lineHeight) || 24;
    const next: GutterBlock[] = [];
    const selectionPos = editor.state.selection.from;
    const foldedHeadingPositions = getCollapsedHeadingPositions(editor);
    editor.state.doc.forEach((node, pos, index) => {
      const dom = editor.view.nodeDOM(pos);
      if (!(dom instanceof HTMLElement)) return;
      if (dom.classList.contains("heading-fold-hidden")) return;
      const rect = dom.getBoundingClientRect();
      next.push({
        index: index + 1,
        pos,
        endPos: pos + node.nodeSize,
        format: blockFormat(node.type.name, node.attrs),
        top: rect.top - rootRect.top,
        firstLineCenter: firstLineTextCenter(
          dom,
          rect,
          node.type.name,
          node.attrs,
          editorLineHeight,
        ) - rootRect.top,
        bottom: rect.bottom - rootRect.top,
        marginBottom: index === editor.state.doc.childCount - 1
          ? Math.max(0, Number.parseFloat(getComputedStyle(dom).marginBottom) || 0)
          : 0,
        active: selectionPos >= pos && selectionPos < pos + node.nodeSize,
        heading: node.type.name === "heading",
        folded: node.type.name === "heading" && foldedHeadingPositions.has(pos),
      });
    });
    setBlocks(next);
    onBlockCountChange?.(editor.state.doc.childCount);
  }, [editor, onBlockCountChange, onHeadingFoldToggle, showInsertButtons, showNumbers]);

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(measure);
  }, [measure]);

  const updateActiveBlock = useCallback(() => {
    const selectionPos = editor.state.selection.from;
    const foldedHeadingPositions = getCollapsedHeadingPositions(editor);
    setBlocks((current) => {
      let changed = false;
      const next = current.map((block) => {
        const active = selectionPos >= block.pos && selectionPos < block.endPos;
        const folded = block.heading && foldedHeadingPositions.has(block.pos);
        if (active === block.active && folded === block.folded) return block;
        changed = true;
        return { ...block, active, folded };
      });
      return changed ? next : current;
    });
  }, [editor]);

  const scheduleDocumentMeasure = useCallback(() => {
    if (documentMeasureTimerRef.current !== null) {
      window.clearTimeout(documentMeasureTimerRef.current);
    }
    // DOM geometry for every top-level block is O(N) and forces layout. Merge
    // a burst of typing into one measurement while selection-only transactions
    // update the active number without touching layout at all.
    documentMeasureTimerRef.current = window.setTimeout(() => {
      documentMeasureTimerRef.current = null;
      scheduleMeasure();
    }, 100);
  }, [scheduleMeasure]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const observer = new ResizeObserver(scheduleDocumentMeasure);
    observer.observe(root);
    observer.observe(editor.view.dom);
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) scheduleDocumentMeasure();
      else updateActiveBlock();
    };
    editor.on("transaction", onTransaction);
    window.addEventListener("resize", scheduleMeasure);
    scheduleMeasure();

    return () => {
      editor.off("transaction", onTransaction);
      window.removeEventListener("resize", scheduleMeasure);
      observer.disconnect();
      if (documentMeasureTimerRef.current !== null) {
        window.clearTimeout(documentMeasureTimerRef.current);
      }
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [editor, scheduleDocumentMeasure, scheduleMeasure, updateActiveBlock]);

  const insertParagraph = (pos: number) => {
    const safePos = Math.min(Math.max(0, pos), editor.state.doc.content.size);
    editor
      .chain()
      .insertContentAt(safePos, { type: "paragraph" })
      .focus(safePos + 1)
      .scrollIntoView()
      .run();
  };

  const boundaries = !showInsertButtons || blocks.length === 0
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
          style={{ top: block.firstLineCenter }}
          aria-hidden="true"
          data-block-format={block.format}
        >
          {block.index}
        </span>
      ))}
      {onHeadingFoldToggle && blocks.filter((block) => block.heading).map((block) => (
        <button
          key={`fold-${block.pos}`}
          type="button"
          className={`editor-heading-fold ${block.folded ? "folded" : ""}`}
          style={{ top: block.firstLineCenter }}
          aria-label={`${block.folded ? "展开" : "折叠"}第 ${block.index} 块章节`}
          title={block.folded ? "展开本节" : "折叠本节"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onHeadingFoldToggle(block.pos)}
        >{block.folded ? "▶" : "▼"}</button>
      ))}
      {!readonly && showInsertButtons && boundaries.map((boundary) => (
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
