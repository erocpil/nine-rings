import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import {
  getCollapsedHeadingPositions,
  getHiddenHeadingFoldBlockPositions,
  headingFoldPluginKey,
} from "../extensions/HeadingFold";

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
  const textRoot = typeName === "codeBlock"
    ? (dom.matches("code") ? dom : dom.querySelector<HTMLElement>("code")) ?? dom
    : dom;
  if (typeName === "codeBlock") {
    // 主块号始终对齐代码正文首行；工具栏高度变化或横竖屏切换不会
    // 再把块号推到工具栏中部。
    const rect = textRoot.getBoundingClientRect();
    const style = getComputedStyle(textRoot);
    const lineHeight = Number.parseFloat(style.lineHeight) || editorLineHeight;
    const inset = (Number.parseFloat(style.borderTopWidth) || 0)
      + (Number.parseFloat(style.paddingTop) || 0);
    return rect.top + inset + lineHeight / 2;
  }
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
  compact?: boolean;
  showNumbers: boolean;
  showInsertButtons: boolean;
  readonly: boolean;
  bookmarkPositions?: readonly number[];
  highlightedBlockIndex?: number | null;
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
export function EditorBlockGutter({ editor, compact = false, showNumbers, showInsertButtons, readonly, bookmarkPositions = [], highlightedBlockIndex, onBlockCountChange, onHeadingFoldToggle }: EditorBlockGutterProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const suppressCompatibilityClickUntilRef = useRef(0);
  const lastTouchActionAtRef = useRef(0);
  const touchGestureRef = useRef<{
    identifier: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [blocks, setBlocks] = useState<GutterBlock[]>([]);

  useEffect(() => {
    const root = rootRef.current;
    const scrollRoot = root?.closest<HTMLElement>(".note-editor-scroll");
    if (!root || !scrollRoot || editor.isDestroyed) return;

    const needsAllBlocks = showNumbers || (showInsertButtons && !readonly) || bookmarkPositions.length > 0;
    const needsHeadings = Boolean(onHeadingFoldToggle);
    if (!needsAllBlocks && !needsHeadings) {
      setBlocks((current) => current.length === 0 ? current : []);
      onBlockCountChange?.(editor.state.doc.childCount);
      return;
    }

    let measureFrame = 0;
    let rebuildFrame = 0;
    let windowFrame = 0;
    let documentMeasureTimer = 0;
    let disposed = false;
    let observedWindow = { start: -1, end: -1 };
    let foldedHeadingPositions = getCollapsedHeadingPositions(editor);
    let hiddenFoldBlockPositions = getHiddenHeadingFoldBlockPositions(editor);
    let topLevelBlocks: Array<{ pos: number; index: number; heading: boolean }> = [];
    // 窗口和预读按折叠后的布局顺序计算；原始 index 只用于显示块号。
    let layoutBlocks: typeof topLevelBlocks = [];
    const layoutIndexByPosition = new Map<number, number>();
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
      // IntersectionObserver 的矩形可能来自折叠前布局。先按 ProseMirror
      // 折叠状态过滤，避免隐藏正文重新发布块号、插入按钮或错误边界。
      if (hiddenFoldBlockPositions.has(pos)) return null;
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
      hiddenFoldBlockPositions = getHiddenHeadingFoldBlockPositions(editor);
      const rootTop = root.getBoundingClientRect().top;
      const editorLineHeight = Number.parseFloat(getComputedStyle(editor.view.dom).lineHeight) || 24;
      // 收缩后的 scrollTop 钳制可能发生在首轮重建之后，先复核窗口，
      // 再测量候选集合（包括被延迟 IO 回调移除过的标记）。
      refreshObservedWindow();
      for (const dom of observedIndexes.keys()) {
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

    const intersectionRootMargin = compact
      ? Math.max(96, Math.ceil(scrollRoot.clientHeight * 0.2))
      : Math.max(640, Math.ceil(scrollRoot.clientHeight * 1.5));
    let observerGeneration = 0;
    let intersectionObserver: IntersectionObserver | null = null;
    const createIntersectionObserver = (generation: number) => {
      if (typeof IntersectionObserver === "undefined") return null;
      return new IntersectionObserver((entries) => {
        // 折叠、展开或文档结构变化时会换用新一代观察器。旧观察器即使
        // 在 disconnect 后才送达队列，也不能再用折叠前坐标覆盖当前 gutter。
        if (generation !== observerGeneration
          || disposed
          || editor.isDestroyed
          || !root.isConnected) return;
        let changed = false;
        let rootTop = 0;
        let editorLineHeight = 0;
        let viewport: DOMRect | undefined;
        const ensureMetrics = () => {
          if (editorLineHeight > 0) return;
          rootTop = root.getBoundingClientRect().top;
          editorLineHeight = Number.parseFloat(getComputedStyle(editor.view.dom).lineHeight) || 24;
        };
        for (const entry of entries) {
          const dom = entry.target;
          if (!(dom instanceof HTMLElement)) continue;
          if (!observedIndexes.has(dom)) continue;
          const blockIndex = observedIndexes.get(dom);
          const heading = blockIndex !== undefined && topLevelBlocks[blockIndex - 1]?.heading;
          // 正文沿用 IO 矩形，保留大文件性能；标题使用当前布局，避免
          // 延迟批次把折叠三角重新放到旧坐标。
          const rect = heading ? dom.getBoundingClientRect() : entry.boundingClientRect;
          // 同一代 IO 的 false 回调也可能来自折叠前；标题是否离开视口
          // 必须以当前布局为准，不能先删除再等待下一次滚动恢复。
          if (heading) viewport ??= scrollRoot.getBoundingClientRect();
          const intersects = heading && viewport
            ? rect.height > 0 && rect.bottom >= viewport.top - intersectionRootMargin
              && rect.top <= viewport.bottom + intersectionRootMargin
            : entry.isIntersecting;
          if (!intersects) {
            changed = measuredBlocks.delete(dom) || changed;
            continue;
          }
          ensureMetrics();
          const measured = measureBlock(dom, rect, rootTop, editorLineHeight);
          if (!measured) {
            changed = measuredBlocks.delete(dom) || changed;
            continue;
          }
          measuredBlocks.set(dom, measured);
          changed = true;
        }
        if (changed) publishBlocks();
      }, {
        root: scrollRoot,
        // 桌面端预挂载视口上下约两屏；手机端缩小预读区，避免触摸滚动
        // 与软键盘 resize 时反复测量过多节点。窗口切换会保留重叠控件，
        // 因此缩小预读区也不会再让块号和插入按钮闪失。
        rootMargin: `${intersectionRootMargin}px 0px`,
      });
    };

    const viewportBlockRange = (): { start: number; end: number } => {
      const count = layoutBlocks.length;
      if (count === 0) return { start: 0, end: -1 };
      const fallbackIndex = Math.max(0, Math.min(
        count - 1,
        layoutIndexByPosition.get(topLevelBlocks[editor.state.selection.$from.index(0)]?.pos) ?? 0,
      ));
      try {
        const viewport = scrollRoot.getBoundingClientRect();
        const editorRect = editor.view.dom.getBoundingClientRect();
        const left = Math.max(editorRect.left + 1, Math.min(
          editorRect.right - 1,
          editorRect.left + Math.min(80, Math.max(1, editorRect.width / 2)),
        ));
        const top = Math.max(viewport.top + 1, editorRect.top + 1);
        const bottom = Math.min(viewport.bottom - 1, editorRect.bottom - 1);
        const indexAt = (vertical: number, direction: 1 | -1): number | undefined => {
          // posAtCoords 会让 ProseMirror 读取候选文本块的几何；连续滚动时
          // WebKit 因此可能每帧强制布局。浏览器已经为命中测试维护了结果，
          // elementsFromPoint 再向上找到编辑器顶层块即可得到同一位置。
          const ownerDocument = editor.view.dom.ownerDocument;
          for (let offset = 0; offset <= 192; offset += 16) {
            const probe = Math.max(top, Math.min(bottom, vertical + direction * offset));
            for (const hit of ownerDocument.elementsFromPoint(left, probe)) {
              let target: Element | null = hit;
              while (target && target.parentElement !== editor.view.dom) {
                if (target === editor.view.dom) break;
                target = target.parentElement;
              }
              if (!(target instanceof HTMLElement) || target.parentElement !== editor.view.dom) continue;
              try {
                const position = positionForDom(target);
                const index = layoutIndexByPosition.get(position);
                if (index !== undefined) return index;
              } catch {
                // Try the next hit/probe.
              }
            }
          }
          return undefined;
        };
        if (bottom <= top) return { start: fallbackIndex, end: fallbackIndex };
        let first = indexAt(top, 1);
        let last = indexAt(bottom, -1);
        if (first === undefined || last === undefined) {
          // 尾部留白、段间距或覆盖层可让命中测试完全落空。对折叠后
          // 有序的布局块二分定位边界，不把末块错误地退回首块，也不在
          // 每次滚动时扫描全文 DOM。仅回退路径读取 O(log n) 个矩形。
          const rects = new Map<number, DOMRect>();
          const rectAt = (index: number) => {
            let rect = rects.get(index);
            if (!rect) {
              const dom = editor.view.nodeDOM(layoutBlocks[index].pos);
              if (!(dom instanceof HTMLElement)) throw new Error("Missing layout block");
              rect = dom.getBoundingClientRect();
              rects.set(index, rect);
            }
            return rect;
          };
          const lowerBound = (after: (rect: DOMRect) => boolean) => {
            let low = 0;
            let high = count;
            while (low < high) {
              const middle = (low + high) >>> 1;
              if (after(rectAt(middle))) high = middle;
              else low = middle + 1;
            }
            return low;
          };
          first ??= Math.min(count - 1, lowerBound((rect) => rect.bottom >= top));
          last ??= Math.max(0, lowerBound((rect) => rect.top > bottom) - 1);
        }
        return { start: Math.min(first, last), end: Math.max(first, last) };
      } catch {
        return { start: fallbackIndex, end: fallbackIndex };
      }
    };

    const refreshObservedWindow = (force = false) => {
      windowFrame = 0;
      if (disposed || editor.isDestroyed || !root.isConnected) return;
      const visible = viewportBlockRange();
      // 只让 WebKit 跟踪当前视口附近的顶层块。旧实现会对大文档中的
      // 每个块调用 nodeDOM + IntersectionObserver.observe，首次布局成本
      // 随全文长度增长，并在 WebKitGTK 中造成明显假死。
      const overscan = compact ? 20 : 48;
      const start = Math.max(0, visible.start - overscan);
      const end = Math.min(layoutBlocks.length - 1, visible.end + overscan);
      if (!force && start === observedWindow.start && end === observedWindow.end) return;
      observedWindow = { start, end };
      const nextObservedIndexes = new Map<HTMLElement, number>();
      // 强制重建发生在折叠事务之后。此时不能只等待 IntersectionObserver：
      // WebView / WebKit 可能要到下一次滚动才回调，已经隐藏的正文块号便会
      // 暂留在旧坐标。force 时同步读取当前布局，立即淘汰高度为 0 的块。
      const measureImmediately = force || !intersectionObserver;
      const rootTop = measureImmediately ? root.getBoundingClientRect().top : 0;
      const editorLineHeight = measureImmediately
        ? Number.parseFloat(getComputedStyle(editor.view.dom).lineHeight) || 24
        : 0;
      for (let blockIndex = start; blockIndex <= end; blockIndex += 1) {
        const block = layoutBlocks[blockIndex];
        if (!block
          || hiddenFoldBlockPositions.has(block.pos)
          || (!needsAllBlocks && !block.heading)) continue;
        const dom = editor.view.nodeDOM(block.pos);
        if (!(dom instanceof HTMLElement)) continue;
        nextObservedIndexes.set(dom, block.index);
        if (intersectionObserver) {
          if (!observedIndexes.has(dom)) intersectionObserver.observe(dom);
        }
        if (measureImmediately) {
          const measured = measureBlock(dom, dom.getBoundingClientRect(), rootTop, editorLineHeight);
          if (measured) measuredBlocks.set(dom, measured);
          else measuredBlocks.delete(dom);
        }
      }
      for (const dom of observedIndexes.keys()) {
        if (nextObservedIndexes.has(dom)) continue;
        intersectionObserver?.unobserve(dom);
        measuredBlocks.delete(dom);
      }
      observedIndexes.clear();
      for (const [dom, index] of nextObservedIndexes) observedIndexes.set(dom, index);
      publishBlocks();
    };

    const scheduleWindowRefresh = () => {
      if (windowFrame) return;
      windowFrame = requestAnimationFrame(() => refreshObservedWindow());
    };

    const rebuildObservedBlocks = () => {
      rebuildFrame = 0;
      if (disposed || editor.isDestroyed || !root.isConnected) return;
      intersectionObserver?.disconnect();
      intersectionObserver = createIntersectionObserver(observerGeneration);
      observedIndexes.clear();
      measuredBlocks.clear();
      foldedHeadingPositions = getCollapsedHeadingPositions(editor);
      hiddenFoldBlockPositions = getHiddenHeadingFoldBlockPositions(editor);
      topLevelBlocks = [];
      editor.state.doc.forEach((node, pos, index) => {
        topLevelBlocks.push({ pos, index: index + 1, heading: node.type.name === "heading" });
      });
      layoutBlocks = topLevelBlocks.filter((block) => !hiddenFoldBlockPositions.has(block.pos));
      layoutIndexByPosition.clear();
      layoutBlocks.forEach((block, index) => layoutIndexByPosition.set(block.pos, index));
      onBlockCountChange?.(editor.state.doc.childCount);
      refreshObservedWindow(true);
      // iOS WebKit 在文档尾部收缩、scrollTop 被浏览器自动钳制时，首帧可能
      // 仍返回折叠前的矩形。下一帧复核已挂载的块，避免尾段块号滞留或错位。
      scheduleVisibleMeasure();
    };

    const scheduleRebuild = () => {
      if (rebuildFrame) return;
      // 先同步使旧观察器失效，再等下一帧读取新布局。这样不需要在每个
      // IntersectionObserver 回调里逐块重新测量，也能挡住折叠前的陈旧批次。
      observerGeneration += 1;
      intersectionObserver?.disconnect();
      intersectionObserver = null;
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
        hiddenFoldBlockPositions = getHiddenHeadingFoldBlockPositions(editor);
        // 折叠事务本身已经同步提交。先直接更新现有 gutter 数据，让三角
        // 在本次点击中立即翻转，并立即剔除语义上已隐藏的正文。下一帧
        // 重建只负责重新测量变化后的可见布局。
        let foldVisibilityChanged = false;
        for (const [dom, block] of measuredBlocks) {
          if (hiddenFoldBlockPositions.has(block.pos)) {
            measuredBlocks.delete(dom);
            foldVisibilityChanged = true;
            continue;
          }
          if (!block.heading) continue;
          const folded = foldedHeadingPositions.has(block.pos);
          if (folded === block.folded) continue;
          measuredBlocks.set(dom, { ...block, folded });
          foldVisibilityChanged = true;
        }
        if (foldVisibilityChanged) publishBlocks();
        scheduleRebuild();
      } else if (transaction.docChanged) {
        scheduleDocumentMeasure();
      } else {
        updateActiveBlock();
      }
    };
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          scheduleDocumentMeasure();
          scheduleWindowRefresh();
        });
    resizeObserver?.observe(root);
    resizeObserver?.observe(editor.view.dom);
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(scheduleRebuild);
    mutationObserver?.observe(editor.view.dom, { childList: true });
    editor.on("transaction", onTransaction);
    scrollRoot.addEventListener("scroll", scheduleWindowRefresh, { passive: true });
    window.addEventListener("resize", scheduleWindowRefresh);
    rebuildObservedBlocks();

    return () => {
      disposed = true;
      observerGeneration += 1;
      editor.off("transaction", onTransaction);
      scrollRoot.removeEventListener("scroll", scheduleWindowRefresh);
      window.removeEventListener("resize", scheduleWindowRefresh);
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (documentMeasureTimer) window.clearTimeout(documentMeasureTimer);
      if (measureFrame) cancelAnimationFrame(measureFrame);
      if (rebuildFrame) cancelAnimationFrame(rebuildFrame);
      if (windowFrame) cancelAnimationFrame(windowFrame);
    };
  }, [bookmarkPositions.length, compact, editor, onBlockCountChange, onHeadingFoldToggle, readonly, showInsertButtons, showNumbers]);

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

  const blockHasBookmark = (block: GutterBlock) => bookmarkPositions.some(
    (position) => position >= block.pos && position < block.endPos,
  );

  const startGutterTouch = (event: React.TouchEvent<HTMLButtonElement>) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    touchGestureRef.current = {
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      moved: false,
    };
  };

  const moveGutterTouch = (event: React.TouchEvent<HTMLButtonElement>) => {
    const gesture = touchGestureRef.current;
    if (!gesture) return;
    const touch = Array.from(event.touches).find((item) => item.identifier === gesture.identifier);
    if (!touch || Math.hypot(touch.clientX - gesture.startX, touch.clientY - gesture.startY) > 12) {
      gesture.moved = true;
    }
  };

  const cancelGutterTouch = () => {
    touchGestureRef.current = null;
  };

  const runGutterActionFromTouch = (event: React.TouchEvent<HTMLButtonElement>, action: () => void) => {
    const gesture = touchGestureRef.current;
    touchGestureRef.current = null;
    if (!gesture || gesture.moved) return;
    const touch = Array.from(event.changedTouches)
      .find((item) => item.identifier === gesture.identifier);
    if (!touch || Math.hypot(touch.clientX - gesture.startX, touch.clientY - gesture.startY) > 12) return;
    const now = Date.now();
    if (now - lastTouchActionAtRef.current < 32) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // iOS 安装版在可滚动编辑器内可能把 pointerup 改派为 pointercancel，
    // 但仍会可靠地产生 touchend。直接在 touchend 完成操作并吞掉合成 click。
    event.preventDefault();
    event.stopPropagation();
    lastTouchActionAtRef.current = now;
    suppressCompatibilityClickUntilRef.current = now + 2000;
    action();
  };

  const runGutterActionFromClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    action: () => void,
  ) => {
    const sourceCapabilities = (event.nativeEvent as MouseEvent & {
      sourceCapabilities?: { firesTouchEvents?: boolean } | null;
    }).sourceCapabilities;
    if (sourceCapabilities?.firesTouchEvents || Date.now() < suppressCompatibilityClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    action();
  };

  return (
    <div
      ref={rootRef}
      className="editor-block-gutter"
      aria-hidden={readonly && !showNumbers && !onHeadingFoldToggle}
    >
      {showNumbers && blocks.map((block) => (
        <span
          key={`number-${block.pos}`}
          className={`editor-block-number ${block.active ? "active" : ""} ${blockHasBookmark(block) ? "bookmarked" : ""} ${block.index === highlightedBlockIndex ? "bookmark-jump-gutter" : ""}`}
          style={{ top: block.firstLineCenter }}
          aria-hidden="true"
          data-block-index={block.index}
          data-block-format={block.format}
        >
          {block.index}
        </span>
      ))}
      {!showNumbers && blocks.filter(blockHasBookmark).map((block) => (
        <span
          key={`bookmark-${block.pos}`}
          className={`editor-block-bookmark without-number ${block.index === highlightedBlockIndex ? "bookmark-jump-gutter" : ""}`}
          style={{ top: block.firstLineCenter }}
          aria-hidden="true"
          data-block-index={block.index}
          title={`第 ${block.index} 块有书签`}
        />
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
          onTouchStart={startGutterTouch}
          onTouchMove={moveGutterTouch}
          onTouchCancel={cancelGutterTouch}
          onTouchEnd={(event) => runGutterActionFromTouch(event, () => onHeadingFoldToggle(block.pos))}
          onClick={(event) => runGutterActionFromClick(event, () => onHeadingFoldToggle(block.pos))}
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
          onTouchStart={startGutterTouch}
          onTouchMove={moveGutterTouch}
          onTouchCancel={cancelGutterTouch}
          onTouchEnd={(event) => runGutterActionFromTouch(event, () => insertParagraph(boundary.pos))}
          onClick={(event) => runGutterActionFromClick(event, () => insertParagraph(boundary.pos))}
        >
          +
        </button>
      ))}
    </div>
  );
}
