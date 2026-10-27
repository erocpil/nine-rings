import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { copyToClipboard } from "../lib/clipboard";
import { extractDocumentOutline } from "../lib/document-outline";
import { headingLinkTarget } from "../lib/heading-links";
import { footnoteLinkTarget, scrollToFootnote } from "../lib/footnote-navigation";
import { listFollowupBlocks } from "../lib/list-followup-blocks";
import type { ReadingBlockState } from "../lib/reading-block-session";
import { renderReadonlyBlock } from "./ReadonlyVirtualNote";
import { DocumentOutlineContext } from "./TableOfContentsBlock";
import { useDocumentHoverPreview } from "./FootnoteHoverPreview";
import { NotesContextMenu, type NotesMenuTarget } from "./NotesContextMenu";
import { ReadingBlockGutter } from "./ReadingBlockGutter";
import { BlockActionMenu, type BlockMenuAction } from "./BlockActionMenu";
import { blockReadingActions, blockSpecificMenu } from "./block-specific-actions";
import { copyDocumentBlock } from "../lib/block-clipboard";
import { readingBlocks } from "../lib/readonly-rendering";
import { extractHeadingSections, headingSectionAtPosition, sessionHeadingFoldStore } from "../lib/heading-fold";
import { editorGutterWidth } from "../lib/editor-gutter";
import { firstLineTextCenter } from "../lib/block-gutter-geometry";
import { relativeNumber } from "../lib/relative-numbering";
import { useRelativeNumbering } from "../hooks/useRelativeNumbering";
import { useNumberingDisplay } from "../hooks/useNumberingDisplay";
import { useMobileViewport } from "../hooks/useEdgeDrawer";
import { CopyBlockNotice } from "./CopyBlockNotice";

export const MARKDOWN_READING_NAVIGATE_EVENT = "nine-rings:markdown-reading-navigate";

/** View state belongs to the file session; rendering never rewrites the raw source. */
export interface MarkdownReadingSession {
  readonly identity: string;
  readonly source: string;
  scrollTop: number;
  states: Map<number, ReadingBlockState>;
  foldedHeadings: Set<string>;
  activePos?: number;
}

/** Shared read-only Markdown projection, independent of database document identity. */
export function MarkdownReadingView({ doc, source, session, fontSize, highlightActiveLine, showLineNumbers, doubleClickFold = false, className = "", onClick, onActivePosition }: {
  doc: PMNode;
  source: string;
  session: MarkdownReadingSession;
  fontSize: number;
  highlightActiveLine: boolean;
  showLineNumbers: boolean;
  doubleClickFold?: boolean;
  className?: string;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onActivePosition?: (position: number) => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [revision, redraw] = useState(0);
  const [blockMenu, setBlockMenu] = useState<{ pos: number; number: number; trigger: HTMLButtonElement } | null>(null);
  const pendingAnchor = useRef<{ pos: number; top: number } | null>(null);
  const pendingJump = useRef<number | null>(null);
  const lastFold = useRef(0);
  const lastTouchFold = useRef(0);
  const touch = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const lastTap = useRef<{ pos: number; time: number; x: number; y: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState<(NotesMenuTarget & { selectedText: string }) | null>(null);
  const numbering = useNumberingDisplay();
  const showNumbers = numbering.blocks?.visible ?? showLineNumbers;
  const { relativeBlockNumbers, relativeBlockNumberAlignment } = useRelativeNumbering();
  const compact = useMobileViewport();
  const documentHover = useDocumentHoverPreview(() => doc);
  useEffect(() => {
    if (!notice || notice.includes("失败")) return;
    const timer = setTimeout(() => setNotice(""), 2200);
    return () => clearTimeout(timer);
  }, [notice]);
  const folds = session.foldedHeadings;
  const blocks = useMemo(() => readingBlocks(doc, folds), [doc, folds]);
  const sections = useMemo(() => extractHeadingSections(doc), [doc]);
  const sectionByPos = useMemo(() => new Map(sections.map(section => [section.pos, section])), [sections]);
  const visibleNumbers = useMemo(() => blocks.map(block => block.number), [blocks]);
  const current = blocks.find(block => block.pos === session.activePos) ?? blocks[0];
  const items = useMemo(() => extractDocumentOutline(doc), [doc]);
  const followups = useMemo(() => listFollowupBlocks(doc), [doc]);
  const rowAt = (pos: number) => content.current?.querySelector<HTMLElement>(`[data-reading-position="${pos}"]`) ?? null;
  const activate = (pos: number) => {
    session.activePos = pos;
    onActivePosition?.(pos);
    redraw(value => value + 1);
  };
  const toggleHeading = (pos: number) => {
    const section = sectionByPos.get(pos);
    if (!section || section.end <= section.headingEnd) return;
    const row = rowAt(pos);
    if (row) pendingAnchor.current = { pos, top: row.getBoundingClientRect().top };
    const next = new Set(folds);
    if (next.has(section.key)) next.delete(section.key);
    else next.add(section.key);
    session.foldedHeadings = next;
    sessionHeadingFoldStore.save(`local-file:${session.identity}`, { version: 1, collapsedKeys: [...next] });
    activate(pos);
  };
  const navigate = (item: { pos: number }) => {
    const root = content.current;
    if (!root) return;
    const next = new Set(folds);
    for (const section of sections) if (section.headingEnd <= item.pos && item.pos < section.end) next.delete(section.key);
    if (next.size !== folds.size) {
      session.foldedHeadings = next;
      sessionHeadingFoldStore.save(`local-file:${session.identity}`, { version: 1, collapsedKeys: [...next] });
      pendingJump.current = item.pos;
      activate(item.pos);
      return;
    }
    const block = Array.from(root.querySelectorAll<HTMLElement>("[data-reading-position]"))
      .reverse().find(element => Number(element.dataset.readingPosition) <= item.pos);
    if (block) {
      root.scrollTop += block.getBoundingClientRect().top - root.getBoundingClientRect().top;
      activate(Number(block.dataset.readingPosition));
    }
  };
  useEffect(() => {
    const root = content.current;
    if (!root) return;
    const jump = (event: Event) => {
      const position = (event as CustomEvent<{ position?: number }>).detail?.position;
      if (Number.isSafeInteger(position) && position! >= 0 && position! <= doc.content.size) navigate({ pos: position! });
    };
    root.addEventListener(MARKDOWN_READING_NAVIGATE_EVENT, jump);
    return () => root.removeEventListener(MARKDOWN_READING_NAVIGATE_EVENT, jump);
  });
  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = session.scrollTop;
  }, [session]);
  useLayoutEffect(() => {
    const root = content.current;
    if (!root) return;
    if (pendingJump.current !== null) {
      const position = pendingJump.current;
      pendingJump.current = null;
      navigate({ pos: position });
    }
    const anchor = pendingAnchor.current;
    pendingAnchor.current = null;
    const row = anchor && rowAt(anchor.pos);
    if (row && anchor) root.scrollTop += row.getBoundingClientRect().top - anchor.top;
    session.scrollTop = root.scrollTop;
  });
  // Share full-editor first-line geometry; only measure visible rows on scroll.
  const measureGutters = useCallback(() => {
    const root = content.current, container = body.current;
    if (!root || !container) return;
    const viewport = root.getBoundingClientRect();
    root.style.setProperty("--reading-viewport-height", `${root.clientHeight}px`);
    const rows = container.children;
    let low = 0, high = rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const rect = rows[middle].getBoundingClientRect();
      if (rect.bottom < viewport.top - 200) low = middle + 1;
      else high = middle;
    }
    const updates: Array<[HTMLElement, string]> = [];
    for (let index = low; index < rows.length; index++) {
      const row = rows[index] as HTMLElement;
      const rect = row.getBoundingClientRect();
      if (rect.top > viewport.bottom + 200) break;
      const block = row.querySelector<HTMLElement>(".vr-block");
      const child = block?.firstElementChild;
      if (!block || !(child instanceof HTMLElement)) continue;
      const target = child.matches("h1,h2,h3,h4,h5,h6") ? child : block;
      const targetRect = target.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(target).lineHeight) || fontSize * 1.5;
      const center = firstLineTextCenter(target, targetRect, row.dataset.blockType ?? "", lineHeight);
      updates.push([row, `${center - rect.top}px`]);
    }
    for (const [row, top] of updates) row.style.setProperty("--reading-gutter-center", top);
  }, [fontSize]);
  useLayoutEffect(measureGutters, [measureGutters, revision, doc, showNumbers, numbering, compact]);
  useEffect(() => {
    const root = content.current, container = body.current;
    if (!root || !container) return;
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measureGutters); };
    const observer = new ResizeObserver(schedule);
    observer.observe(root); observer.observe(container);
    root.addEventListener("scroll", schedule, { passive: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); root.removeEventListener("scroll", schedule); };
  }, [measureGutters]);
  const updateBlock = (at: number, value: ReadingBlockState) => {
    session.states.set(at, { ...session.states.get(at), ...value });
    const block = [...blocks].reverse().find(block => block.pos <= at);
    if (block) { session.activePos = block.pos; onActivePosition?.(block.pos); }
    redraw(previous => previous + 1);
  };
  const openBlockMenu = (pos: number, number: number, trigger: HTMLButtonElement) => {
    activate(pos);
    setBlockMenu(previous => previous?.pos === pos ? null : { pos, number, trigger });
  };
  const blockMenuActions = (): BlockMenuAction[] => {
    if (!blockMenu) return [];
    const node = doc.nodeAt(blockMenu.pos);
    if (!node) return [];
    const actions: BlockMenuAction[] = (["formatted", "markdown", "text"] as const).map((mode, index) => ({
      label: ["复制内容", "复制 Markdown", "复制纯文本"][index], run: () => { void copyDocumentBlock(doc, blockMenu.pos, mode).then(() => setNotice("已复制此块"), () => setNotice("复制块失败，请重试")); },
    }));
    const section = sectionByPos.get(blockMenu.pos);
    if (section && section.end > section.headingEnd) actions.push({ label: "折叠 / 展开本节", run: () => toggleHeading(blockMenu.pos) });
    else if (["codeBlock", "blockquote", "htmlDetails"].includes(node.type.name)) actions.push({ label: "折叠 / 展开此块", run: () => updateBlock(blockMenu.pos, {
      collapsed: !(session.states.get(blockMenu.pos)?.collapsed ?? (node.type.name === "htmlDetails" ? node.attrs.open !== true : node.attrs.collapsed === true)),
    }) });
    actions.push(...blockSpecificMenu(blockReadingActions(rowAt(blockMenu.pos), node.type.name)));
    return actions;
  };
  return <DocumentOutlineContext.Provider value={{ items, navigate }}>
    <div ref={content} className={`editor-content note-editor-scroll vr-note markdown-reading-view ${className}${showNumbers ? " show-line-numbers" : ""}${highlightActiveLine ? "" : " no-active-line"}`}
      aria-label="Markdown 渲染" tabIndex={0} style={{ fontSize, "--editor-gutter-width": `${editorGutterWidth(doc.childCount, showNumbers, compact)}px`, "--editor-gutter-text-gap": showNumbers ? "4px" : "0px" } as CSSProperties}
      onScroll={event => { session.scrollTop = event.currentTarget.scrollTop; }}
      onPointerOver={documentHover.onPointerOver} onPointerOut={documentHover.onPointerOut}
      onFocusCapture={documentHover.onFocusCapture} onBlurCapture={documentHover.onBlurCapture}
      onScrollCapture={documentHover.onScrollCapture}
      onClick={event => {
        if (event.target instanceof Element && event.target.closest("button,input,select,textarea")) return;
        if (event.detail >= 3 && Date.now() - lastFold.current < 450) return;
        const heading = headingLinkTarget(event.target, items, doc);
        if (heading) { event.preventDefault(); navigate(heading); return; }
        const footnote = footnoteLinkTarget(event.target);
        if (footnote) { event.preventDefault(); scrollToFootnote(event.currentTarget, footnote); return; }
        const block = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-reading-position]") : null;
        if (block) {
          activate(Number(block.dataset.readingPosition));
        }
        onClick?.(event);
      }}
      onMouseDown={event => {
        if (doubleClickFold && event.detail >= 2 && event.target instanceof Element && !event.target.closest("button,a,input,select,textarea")) event.preventDefault();
      }}
      onDoubleClick={event => {
        if (!doubleClickFold || !(event.target instanceof Element) || event.target.closest("button,a,input,select,textarea")) return;
        if (Date.now() - lastTouchFold.current < 450) return;
        const row = event.target.closest<HTMLElement>("[data-reading-position]");
        if (!row) return;
        const section = headingSectionAtPosition(sections, Number(row.dataset.readingPosition));
        if (section) { event.preventDefault(); lastFold.current = Date.now(); document.getSelection()?.removeAllRanges(); toggleHeading(section.pos); }
      }}
      onPointerDown={event => {
        if (event.pointerType === "touch") touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      }}
      onPointerMove={event => {
        if (touch.current && Math.hypot(event.clientX - touch.current.x, event.clientY - touch.current.y) > 12) touch.current.moved = true;
      }}
      onPointerCancel={() => { touch.current = null; lastTap.current = null; }}
      onPointerUp={event => {
        const gesture = touch.current;
        touch.current = null;
        if (!doubleClickFold || event.pointerType !== "touch" || !gesture || gesture.id !== event.pointerId || gesture.moved || !(event.target instanceof Element) || event.target.closest("button,a,input,select,textarea")) return;
        const row = event.target.closest<HTMLElement>("[data-reading-position]");
        const section = row && headingSectionAtPosition(sections, Number(row.dataset.readingPosition));
        if (!section || section.end <= section.headingEnd) return;
        const previous = lastTap.current, now = Date.now();
        if (previous && previous.pos === section.pos && now - previous.time < 350 && Math.hypot(previous.x - event.clientX, previous.y - event.clientY) < 24) {
          event.preventDefault();
          lastTap.current = null;
          lastFold.current = now;
          lastTouchFold.current = now;
          document.getSelection()?.removeAllRanges();
          toggleHeading(section.pos);
        } else lastTap.current = { pos: section.pos, time: now, x: event.clientX, y: event.clientY };
      }}
      onContextMenu={event => {
        const selection = document.getSelection();
        const selectedText = selection && !selection.isCollapsed && selection.anchorNode && event.currentTarget.contains(selection.anchorNode) ? selection.toString() : "";
        event.preventDefault();
        setMenu({ id: "markdown-reading", title: "Markdown 渲染", x: event.clientX, y: event.clientY, trigger: event.currentTarget, selectedText });
      }}>
      <div ref={body} className="ProseMirror vr-body" contentEditable={false}>
        {blocks.map(({ node, pos, number }, index) => <div key={pos} data-reading-position={pos} data-reading-row data-position={pos} data-block-number={number} data-block-type={node.type.name}
          className="vr-row"
          data-next-heading={blocks[index + 1]?.node.type.name === "heading" || undefined}
          data-next-heading-level={blocks[index + 1]?.node.type.name === "heading" ? blocks[index + 1].node.attrs.level : undefined}>
          <ReadingBlockGutter node={node} number={number} displayNumber={relativeBlockNumbers ? relativeNumber(number, current?.number ?? 1, visibleNumbers) : number}
            active={current?.pos === pos} showNumbers={showNumbers} relative={relativeBlockNumbers} alignment={relativeBlockNumberAlignment}
            section={sectionByPos.get(pos)} folded={!!sectionByPos.get(pos) && folds.has(sectionByPos.get(pos)!.key)} onToggleFold={() => toggleHeading(pos)}
            onOpen={trigger => openBlockMenu(pos, number, trigger)} />
          <div className={`ProseMirror vr-block${highlightActiveLine && current?.pos === pos ? " ProseMirror-activeline" : ""}`}>
            {renderReadonlyBlock(node, pos, session.states, updateBlock, undefined, true, followups.has(pos))}
          </div>
        </div>)}
      </div>
      {documentHover.preview}
      <CopyBlockNotice message={notice} onClose={() => setNotice("")} />
      {blockMenu && <BlockActionMenu title={`第 ${blockMenu.number} 块`} blockNumber={blockMenu.number} blockType={doc.nodeAt(blockMenu.pos)?.type.name}
        trigger={blockMenu.trigger} actions={blockMenuActions()} onClose={() => setBlockMenu(null)} />}
      <div className="editor-menu local-preview-selection-commands" aria-hidden="true" hidden><button type="button" data-context-visible="true" aria-label="复制选中文本" title="复制选中文本" onClick={() => {
        const text = document.getSelection()?.toString();
        if (text) void copyToClipboard(text, { reportFailure: true });
      }}>复制</button></div>
      {menu && <NotesContextMenu target={menu} close={() => setMenu(null)} actions={menu.selectedText
        ? [{ label: "复制选中文本", run: () => { void copyToClipboard(menu.selectedText, { reportFailure: true }); } }]
        : [
          { label: "复制 Markdown 原文", run: () => { void copyToClipboard(source, { reportFailure: true }); } },
          { label: "选择全部文本", run: () => {
            const body = content.current?.querySelector(".ProseMirror");
            if (!body) return;
            const range = document.createRange(); range.selectNodeContents(body);
            const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
          } },
        ]} />}
    </div>
  </DocumentOutlineContext.Provider>;
}
