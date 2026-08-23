import { useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { getCollapsedHeadingPositions, headingFoldPluginKey } from "../extensions/HeadingFold";

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
  fallbackRect: Pick<DOMRectReadOnly, "top" | "height">,
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
  // CodeBlock NodeView 在正文前还包含语言选择器、复制按钮和内部行号。
  // 必须从真正的 code contentDOM 开始查找，否则 select/option 的不可测量
  // 文本会触发整块中心兜底，使长代码块的主块号落在中部。
  const textRoot = typeName === "codeBlock"
    ? dom.querySelector<HTMLElement>("code") ?? dom
    : dom;
  const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent ?? "";
      const firstVisible = text.search(/\S/);
      if (firstVisible < 0) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest("button, select, option, input, textarea, .code-block-gutter, .column-resize-handle")) {
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
  if (typeName === "codeBlock" && textRoot !== dom) {
    const rect = textRoot.getBoundingClientRect();
    const style = getComputedStyle(textRoot);
    const lineHeight = Number.parseFloat(style.lineHeight) || editorLineHeight;
    const inset = (Number.parseFloat(style.borderTopWidth) || 0)
      + (Number.parseFloat(style.paddingTop) || 0);
    return rect.top + inset + lineHeight / 2;
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
 * 用户意图。IntersectionObserver 只挂载视口及预读区域内的控件；
 * ResizeObserver 只重新测量这部分节点，避免长文档复制一整套 gutter DOM。
 */
export function EditorBlockGutter({ editor, showNumbers, showInsertButtons, readonly, onBlockCountChange, onHeadingFoldToggle }: EditorBlockGutterProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [blocks, setBlocks] = useState<GutterBlock[]>([]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const scrollRoot = root?.closest<HTMLElement>(".note-editor-scroll");
    if (!root || !scrollRoot || editor.isDestroyed) return;

    const needsAllBlocks = showNumbers || (showInsertButtons && !readonly);
    const needsHeadings = Boolean(onHeadingFoldToggle);
    if (!needsAllBlocks && !needsHeadings) {
      setBlocks((current) => current.length === 0 ? current : []);
      onBlockCountChange?.(editor.state.doc.childCount);
      return;
    }

    let measureFrame = 0;
    let rebuildFrame = 0;
    let documentMeasureTimer = 0;
    let disposed = false;
    let foldedHeadingPositions = getCollapsedHeadingPositions(editor);
    const observedIndexes = new Map<HTMLElement, number>();
    const measuredBlocks = new Map<HTMLElement, GutterBlock>();

    const publishBlocks = () => {
      setBlocks([...measuredBlocks.values()].sort((left, right) => left.index - right.index));
    };

    const positionForDom = (dom: HTMLElement) => {
      const domPosition = editor.view.posAtDOM(dom, 0, -1);
      const position = Math.max(0, Math.min(domPosition, editor.state.doc.content.size));
      const $position = editor.state.doc.resolve(position);
      return $position.depth >= 1 ? $position.before(1) : position;
    };

    const measureBlock = (
      dom: HTMLElement,
      rect: Pick<DOMRectReadOnly, "top" | "bottom" | "height">,
      rootTop: number,
      editorLineHeight: number,
    ): GutterBlock | null => {
      if (!dom.isConnected || rect.height <= 0) return null;
      let pos: number;
      try {
        pos = positionForDom(dom);
      } catch {
        return null;
      }
      const node = editor.state.doc.nodeAt(pos);
      if (!node) return null;
      const index = observedIndexes.get(dom) ?? editor.state.doc.resolve(pos).index(0) + 1;
      const selectionPos = editor.state.selection.from;
      return {
        index,
        pos,
        endPos: pos + node.nodeSize,
        format: blockFormat(node.type.name, node.attrs),
        top: rect.top - rootTop,
        firstLineCenter: firstLineTextCenter(
          dom,
          rect,
          node.type.name,
          node.attrs,
          editorLineHeight,
        ) - rootTop,
        bottom: rect.bottom - rootTop,
        marginBottom: index === editor.state.doc.childCount
          ? Math.max(0, Number.parseFloat(getComputedStyle(dom).marginBottom) || 0)
          : 0,
        active: selectionPos >= pos && selectionPos < pos + node.nodeSize,
        heading: node.type.name === "heading",
        folded: node.type.name === "heading" && foldedHeadingPositions.has(pos),
      };
    };

    const measureVisibleBlocks = () => {
      measureFrame = 0;
      if (disposed || editor.isDestroyed || !root.isConnected) return;
      foldedHeadingPositions = getCollapsedHeadingPositions(editor);
      const rootTop = root.getBoundingClientRect().top;
      const editorLineHeight = Number.parseFloat(getComputedStyle(editor.view.dom).lineHeight) || 24;
      for (const dom of [...measuredBlocks.keys()]) {
        const measured = measureBlock(dom, dom.getBoundingClientRect(), rootTop, editorLineHeight);
        if (measured) measuredBlocks.set(dom, measured);
        else measuredBlocks.delete(dom);
      }
      publishBlocks();
    };

    const scheduleVisibleMeasure = () => {
      if (measureFrame) return;
      measureFrame = requestAnimationFrame(measureVisibleBlocks);
    };

    const intersectionObserver = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
        if (disposed || editor.isDestroyed || !root.isConnected) return;
        let changed = false;
        let rootTop = 0;
        let editorLineHeight = 0;
        const ensureMetrics = () => {
          if (editorLineHeight > 0) return;
          rootTop = root.getBoundingClientRect().top;
          editorLineHeight = Number.parseFloat(getComputedStyle(editor.view.dom).lineHeight) || 24;
        };
        for (const entry of entries) {
          const dom = entry.target;
          if (!(dom instanceof HTMLElement)) continue;
          if (!observedIndexes.has(dom)) continue;
          if (!entry.isIntersecting) {
            changed = measuredBlocks.delete(dom) || changed;
            continue;
          }
          ensureMetrics();
          const measured = measureBlock(dom, entry.boundingClientRect, rootTop, editorLineHeight);
          if (!measured) continue;
          measuredBlocks.set(dom, measured);
          changed = true;
        }
        if (changed) publishBlocks();
      }, {
        root: scrollRoot,
        // 预挂载视口上下约两屏的 gutter 控件。快速滑动时目标块号已经
        // 就绪，同时整篇长文档仍只保留几十个块号/插入按钮 DOM。
        rootMargin: `${Math.max(640, Math.ceil(scrollRoot.clientHeight * 1.5))}px 0px`,
      });

    const rebuildObservedBlocks = () => {
      rebuildFrame = 0;
      if (disposed || editor.isDestroyed || !root.isConnected) return;
      intersectionObserver?.disconnect();
      observedIndexes.clear();
      measuredBlocks.clear();
      foldedHeadingPositions = getCollapsedHeadingPositions(editor);
      const rootTop = intersectionObserver ? 0 : root.getBoundingClientRect().top;
      const editorLineHeight = intersectionObserver
        ? 0
        : Number.parseFloat(getComputedStyle(editor.view.dom).lineHeight) || 24;
      editor.state.doc.forEach((node, pos, index) => {
        if (!needsAllBlocks && node.type.name !== "heading") return;
        const dom = editor.view.nodeDOM(pos);
        if (!(dom instanceof HTMLElement)) return;
        observedIndexes.set(dom, index + 1);
        if (intersectionObserver) intersectionObserver.observe(dom);
        else {
          const measured = measureBlock(dom, dom.getBoundingClientRect(), rootTop, editorLineHeight);
          if (measured) measuredBlocks.set(dom, measured);
        }
      });
      onBlockCountChange?.(editor.state.doc.childCount);
      publishBlocks();
    };

    const scheduleRebuild = () => {
      if (rebuildFrame) return;
      rebuildFrame = requestAnimationFrame(rebuildObservedBlocks);
    };

    const scheduleDocumentMeasure = () => {
      if (documentMeasureTimer) window.clearTimeout(documentMeasureTimer);
      documentMeasureTimer = window.setTimeout(() => {
        documentMeasureTimer = 0;
        scheduleVisibleMeasure();
      }, 100);
    };

    const updateActiveBlock = () => {
      const selectionPos = editor.state.selection.from;
      let changed = false;
      for (const [dom, block] of measuredBlocks) {
        const active = selectionPos >= block.pos && selectionPos < block.endPos;
        if (active === block.active) continue;
        measuredBlocks.set(dom, { ...block, active });
        changed = true;
      }
      if (changed) publishBlocks();
    };

    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.getMeta(headingFoldPluginKey)) {
        foldedHeadingPositions = getCollapsedHeadingPositions(editor);
        scheduleRebuild();
      } else if (transaction.docChanged) {
        scheduleDocumentMeasure();
      } else {
        updateActiveBlock();
      }
    };
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleDocumentMeasure);
    resizeObserver?.observe(root);
    resizeObserver?.observe(editor.view.dom);
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(scheduleRebuild);
    mutationObserver?.observe(editor.view.dom, { childList: true });
    editor.on("transaction", onTransaction);
    window.addEventListener("resize", scheduleVisibleMeasure);
    rebuildObservedBlocks();

    return () => {
      disposed = true;
      editor.off("transaction", onTransaction);
      window.removeEventListener("resize", scheduleVisibleMeasure);
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (documentMeasureTimer) window.clearTimeout(documentMeasureTimer);
      if (measureFrame) cancelAnimationFrame(measureFrame);
      if (rebuildFrame) cancelAnimationFrame(rebuildFrame);
    };
  }, [editor, onBlockCountChange, onHeadingFoldToggle, readonly, showInsertButtons, showNumbers]);

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
        ...(blocks[0].index === 1
          ? [{ key: "start", pos: blocks[0].pos, top: blocks[0].top, label: "在第一块前插入段落" }]
          : []),
        ...blocks.map((block, index) => {
          const nextBlock = blocks[index + 1];
          // IntersectionObserver 的批次边界可能暂时让窗口内块不连续；此时
          // 不能把跨越多块的距离误当成相邻块间距，否则会在正文中央生成“+”。
          const gap = nextBlock?.index === block.index + 1
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
    <div
      ref={rootRef}
      className="editor-block-gutter"
      aria-hidden={readonly && !showNumbers && !onHeadingFoldToggle}
    >
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
