import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
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

/** View state belongs to the file session; rendering never rewrites the raw source. */
export interface MarkdownReadingSession {
  readonly identity: string;
  readonly source: string;
  scrollTop: number;
  states: Map<number, ReadingBlockState>;
  activePos?: number;
}

/** Shared read-only Markdown projection, independent of database document identity. */
export function MarkdownReadingView({ doc, source, session, fontSize, highlightActiveLine, className = "", onClick, onActivePosition }: {
  doc: PMNode;
  source: string;
  session: MarkdownReadingSession;
  fontSize: number;
  highlightActiveLine: boolean;
  className?: string;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onActivePosition?: (position: number) => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [, redraw] = useState(0);
  const [menu, setMenu] = useState<(NotesMenuTarget & { selectedText: string }) | null>(null);
  const documentHover = useDocumentHoverPreview(() => doc);
  const blocks = useMemo(() => {
    const result: Array<{ node: PMNode; pos: number }> = [];
    doc.forEach((node, pos) => result.push({ node, pos }));
    return result;
  }, [doc]);
  const items = useMemo(() => extractDocumentOutline(doc), [doc]);
  const followups = useMemo(() => listFollowupBlocks(doc), [doc]);
  const navigate = (item: { pos: number }) => {
    const root = content.current;
    if (!root) return;
    const block = Array.from(root.querySelectorAll<HTMLElement>("[data-reading-position]"))
      .reverse().find(element => Number(element.dataset.readingPosition) <= item.pos);
    if (block) {
      root.scrollTop += block.getBoundingClientRect().top - root.getBoundingClientRect().top;
      onActivePosition?.(item.pos);
    }
  };
  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = session.scrollTop;
  }, [session]);
  return <DocumentOutlineContext.Provider value={{ items, navigate }}>
    <div ref={content} className={`editor-content note-editor-scroll vr-note markdown-reading-view ${className}${highlightActiveLine ? "" : " no-active-line"}`}
      aria-label="Markdown 渲染" tabIndex={0} style={{ fontSize }}
      onScroll={event => { session.scrollTop = event.currentTarget.scrollTop; }}
      onPointerOver={documentHover.onPointerOver} onPointerOut={documentHover.onPointerOut}
      onFocusCapture={documentHover.onFocusCapture} onBlurCapture={documentHover.onBlurCapture}
      onScrollCapture={documentHover.onScrollCapture}
      onClick={event => {
        const heading = headingLinkTarget(event.target, items, doc);
        if (heading) { event.preventDefault(); navigate(heading); return; }
        const footnote = footnoteLinkTarget(event.target);
        if (footnote) { event.preventDefault(); scrollToFootnote(event.currentTarget, footnote); return; }
        const block = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-reading-position]") : null;
        if (block) {
          session.activePos = Number(block.dataset.readingPosition);
          onActivePosition?.(session.activePos);
          redraw(value => value + 1);
        }
        onClick?.(event);
      }}
      onContextMenu={event => {
        const selection = document.getSelection();
        const selectedText = selection && !selection.isCollapsed && selection.anchorNode && event.currentTarget.contains(selection.anchorNode) ? selection.toString() : "";
        event.preventDefault();
        setMenu({ id: "markdown-reading", title: "Markdown 渲染", x: event.clientX, y: event.clientY, trigger: event.currentTarget, selectedText });
      }}>
      <div className="ProseMirror" contentEditable={false}>
        {blocks.map(({ node, pos }, index) => <div key={pos} data-reading-position={pos}
          className={`ProseMirror vr-block${highlightActiveLine && session.activePos === pos ? " ProseMirror-activeline" : ""}`}
          data-next-heading={blocks[index + 1]?.node.type.name === "heading" || undefined}
          data-next-heading-level={blocks[index + 1]?.node.type.name === "heading" ? blocks[index + 1].node.attrs.level : undefined}>
          {renderReadonlyBlock(node, pos, session.states, (at, value) => {
            session.states.set(at, { ...session.states.get(at), ...value });
            redraw(previous => previous + 1);
          }, undefined, true, followups.has(pos))}
        </div>)}
      </div>
      {documentHover.preview}
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
