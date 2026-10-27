import { useNativeMenuActions } from "../hooks/useNativeMenuActions";
import { EditorStatusBar } from "./EditorStatusBar";
import { useStatusBarDisplay } from "../hooks/useStatusBarDisplay";
import { editorForegroundStyle } from "../lib/editor-color";
import { editorBackgroundStyle } from "../lib/editor-color";
import { cjkSpacedText } from "./CjkSpacedText";
import { PanelDisplayTools, revealPanelItem } from "./PanelDisplayTools";
import { panelDisplayStyle, bookmarkTooltip, sortedPanelItems } from "../lib/panel-display-view";
import { usePanelDisplay } from "../hooks/usePanelDisplay";
import { panelDisplays } from "../lib/plugin-system/panel-display";
import { ReadingBlockGutter } from "./ReadingBlockGutter";
import { useRelativeNumbering } from "../hooks/useRelativeNumbering";
import { relativeNumber } from "../lib/relative-numbering";
import { BlockActionMenu, type BlockMenuAction } from "./BlockActionMenu";
import { blockReadingActions, blockSpecificMenu } from "./block-specific-actions";
import { copyDocumentBlock } from "../lib/block-clipboard";
import { DeferredFlowBlock } from "./DeferredFlowBlock";
import { flowBlockAttributes, flowHeadingLevel } from "../lib/flow-presentation";
import { useDocumentActive } from "./RetainedDocument";
import { READING_TYPOGRAPHY_WILL_CHANGE } from "../lib/reading-position";
import { DocumentPanelTitle, OutlinePanelTitle } from "./OutlinePanelTitle";
import { ReadonlyImage } from "./ReadonlyImage";
import { BlockquoteToolbar } from "./BlockquoteToolbar";
import { useDesktopDocumentPanels } from "../hooks/useDesktopDocumentPanels";
import { listFollowupBlocks } from "../lib/list-followup-blocks";
import { DesktopDocumentPanels, desktopPanelClass, desktopPanelStyle } from "./DesktopDocumentPanels";
import { NavigationButtons } from "./NavigationButtons";
import { useNavigationStore } from "../stores/useNavigationStore";
import { EditorFoldIcon } from "./EditorFoldIcon";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { CopyBlockNotice } from "./CopyBlockNotice";
import { BLOCK_WORKSPACE_DISPLAY_EVENT, codeLineNumbersEnabled, saveBlockWorkspacePreferences } from "../lib/block-display-settings";
import { CODE_LANGUAGE_OPTIONS, normalizeCodeLanguage } from "../lib/code-highlight";
import { Slice } from "@tiptap/pm/model";
import type { NoteEditorProps } from "./NoteEditor";
import { FocusModeBar, FocusModeIcon } from "./FocusModeBar";
import { ToolbarIcon } from "./ToolbarIcon";
import { DeferredMermaidDiagram } from "./DeferredMermaidDiagram";
import { codeBlockDisplay, structuredBlockSymbol } from "../lib/structured-block-display";
import { DocumentTitlePreview } from "./DocumentTitlePreview";
import { queueBlockWorkspace } from "../lib/block-workspace";
import { DocumentPanelDrawer } from "./DocumentPanelDrawer";
import { useDocumentPanelPosition } from "../hooks/useDocumentPanelPosition";
import {
  ReadingLayout,
  readingBlocks,
  handoffReadingAnchor,
  takeReadingAnchor,
  type ReadingAnchor,
} from "../lib/readonly-rendering";
import {
  collapsedHeadingKeysForAll,
  extractHeadingSections,
  sessionHeadingFoldStore,
} from "../lib/heading-fold";
import {
  findSearchMatches,
  type SearchMatch,
} from "../extensions/SearchHighlights";
import { listStyle } from "../extensions/OrderedListLayout";
import { clipboardSliceToPlainText } from "../lib/clipboard-plain-text";
import { copyToClipboard } from "../lib/clipboard";
import { referenceAnchorAt } from "../extensions/ReferenceAnchors";
import { deltaToMarkdown } from "../lib/markdown-serializer";
import { editorGutterWidth } from "../lib/editor-gutter";
import { bindViewportEdgeSwipe, swipeViewport } from "../lib/edge-swipe";
import { useMobileViewport } from "../hooks/useEdgeDrawer";
import { isDocumentFindKeyEvent, isEditorLineJumpKeyEvent, isPrimaryShortcutModifier } from "../lib/shortcuts";
import { readingBlockSession, type ReadingBlockState as BlockState } from "../lib/reading-block-session";
import { READING_POSITION_FLUSH_EVENT, patchReadingState, readReadingState } from "../lib/reading-state";
import { centerSearchMatch } from "../lib/search-scroll";
import { KaTeXFormula } from "../extensions/MarkdownExtras";
import { findFootnoteElement, footnoteBlockPosition, footnoteLinkTarget, scrollToFootnote } from "../lib/footnote-navigation";
import { DocumentOutlineContext, TableOfContentsBlock } from "./TableOfContentsBlock";
import { extractDocumentOutline } from "../lib/document-outline";
import { headingLinkTarget, outlineLabel } from "../lib/heading-links";
import { useDocumentHoverPreview } from "./FootnoteHoverPreview";
import { isRelativeMarkdownLink } from "../lib/relative-document-link";
import { internalNoteId } from "../lib/internal-note-link";
import { createReadingAnnotation, deleteReadingAnnotation, deleteReadingAnnotations, listReadingAnnotations, putReadingAnnotation, reanchorReadingAnnotations, READING_ANNOTATIONS_ENABLED, type ReadingAnnotation } from "../lib/reading-annotations";
import { ReadingAnnotationBubble } from "./ReadingAnnotationBubble";

function readonlyLink(href: string, title: string | undefined, content: React.ReactNode) {
  if (/^(https?:|mailto:|tel:)/i.test(href)) return <a href={href} title={title} target="_blank" rel="noopener noreferrer">{content}</a>;
  if (href.startsWith("#") || isRelativeMarkdownLink(href) || internalNoteId(href)) return <a href={href} title={title}>{content}</a>;
  return content;
}

function readonlyDomPosition(root: HTMLElement, node: Node, offset: number): number | null {
  const element = node instanceof Element ? node : node.parentElement;
  const wrapper = element?.closest<HTMLElement>("[data-reading-text-start][data-reading-text-end]");
  if (!wrapper || !root.contains(wrapper)) return null;
  const from = Number(wrapper.dataset.readingTextStart);
  const to = Number(wrapper.dataset.readingTextEnd);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  try {
    const range = document.createRange();
    range.selectNodeContents(wrapper);
    range.setEnd(node, offset);
    return from + Math.min(to - from, range.toString().length);
  } catch { return null; }
}

function selectedReadonlyRange(root: HTMLElement): { from: number; to: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode
    || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
  const anchor = readonlyDomPosition(root, selection.anchorNode, selection.anchorOffset);
  const focus = readonlyDomPosition(root, selection.focusNode, selection.focusOffset);
  if (anchor === null || focus === null || anchor === focus) return null;
  return { from: Math.min(anchor, focus), to: Math.max(anchor, focus) };
}

export function renderReadonlyBlock(
  node: PMNode,
  pos: number,
  states: Map<number, BlockState>,
  update: (pos: number, value: BlockState) => void,
  match: SearchMatch | undefined,
  defaultWrap: boolean,
  followsList = false,
  spaceText = true,
  previousText = "",
  annotations: readonly ReadingAnnotation[] = [],
): React.ReactNode {
  if (node.isText) {
    const text = node.text ?? "";
    const spaced = (part: string, previous = "") => spaceText && !node.marks.some(mark => mark.type.name === "code")
      ? cjkSpacedText(part, previous) : part;
    const start = Math.max(0, (match?.from ?? Infinity) - pos);
    const end = Math.min(text.length, (match?.to ?? -1) - pos);
    const boundaries = new Set([0, text.length]);
    if (start < end) { boundaries.add(start); boundaries.add(end); }
    const overlapping = annotations.filter(item => item.from < pos + text.length && item.to > pos);
    for (const item of overlapping) {
      boundaries.add(Math.max(0, item.from - pos));
      boundaries.add(Math.min(text.length, item.to - pos));
    }
    const points = [...boundaries].sort((a, b) => a - b);
    let rendered: React.ReactNode = <>{points.slice(0, -1).map((from, index) => {
      const to = points[index + 1];
      if (to <= from) return null;
      const activeSearch = from >= start && to <= end;
      const activeAnnotations = overlapping.filter(item => item.from <= pos + from && item.to >= pos + to);
      let segment: React.ReactNode = spaced(text.slice(from, to), from ? text[from - 1] : previousText);
      if (activeSearch) segment = <mark className="search-match search-match-active">{segment}</mark>;
      for (const annotation of activeAnnotations) {
        segment = <mark className="reading-annotation-highlight" data-reading-annotation={annotation.id}>{segment}</mark>;
      }
      return <span key={from} data-reading-text-start={pos + from} data-reading-text-end={pos + to}>{segment}</span>;
    })}</>;
    for (const mark of node.marks) {
      switch (mark.type.name) {
        case "bold":
          rendered = <strong>{rendered}</strong>;
          break;
        case "italic":
          rendered = <em>{rendered}</em>;
          break;
        case "strike":
          rendered = <s>{rendered}</s>;
          break;
        case "code":
          rendered = <code>{rendered}</code>;
          break;
        case "textStyle":
          rendered = (
            <span
              style={{
                color: editorForegroundStyle(mark.attrs?.color),
                fontSize: mark.attrs.fontSize
                  ? `${Number(mark.attrs.fontSize)}px`
                  : undefined,
              }}
            >
              {rendered}
            </span>
          );
          break;
        case "link": {
          const href = String(mark.attrs.href ?? "");
          rendered = readonlyLink(href, mark.attrs.title ?? undefined, rendered);
          break;
        }
        case "htmlStyle":
          rendered = React.createElement(["sub", "sup", "ins"].includes(mark.attrs.tag) ? mark.attrs.tag : "ins", null, rendered);
          break;
        case "inlineHighlight":
          rendered = <mark style={{ backgroundColor: editorBackgroundStyle(mark.attrs.backgroundColor) }}>{rendered}</mark>;
          break;
        case "footnoteReference": {
          const id = String(mark.attrs.id ?? "");
          const occurrence = Number(mark.attrs.occurrence) || 1;
          rendered = <sup id={`nr-footnote-ref-${encodeURIComponent(id)}${occurrence > 1 ? `-${occurrence}` : ""}`} className="nr-footnote-reference" data-footnote-ref={id}><a href={`#nr-footnote-${encodeURIComponent(id)}`}>{rendered}</a></sup>;
          break;
        }
      }
    }
    return rendered;
  }
  const children: React.ReactNode[] = [];
  node.forEach((child, offset) =>
    children.push(
      <React.Fragment key={offset}>
        {renderReadonlyBlock(
          child,
          pos + offset + 1,
          states,
          update,
          match,
          defaultWrap,
          false,
          spaceText && node.type.name !== "codeBlock",
          node.isTextblock && offset > 0 && !node.childBefore(offset).node?.marks.some(mark => mark.type.name === "code")
            ? node.textBetween(offset - 1, offset) : "",
          annotations,
        )}
      </React.Fragment>,
    ),
  );
  const state = states.get(pos) ?? {};
  const explicitIndent = node.attrs.indentExplicit === true;
  const attrs = {
    "data-indent": node.attrs.indent || explicitIndent ? String(node.attrs.indent || 0) : undefined,
    "data-indent-explicit": explicitIndent ? "true" : undefined,
    "data-list-followup": followsList && !explicitIndent ? true : undefined,
  };
  switch (node.type.name) {
    case "hardBreak":
      return <br />;
    case "horizontalRule":
      return <hr {...attrs} />;
    case "paragraph":
      return <p {...attrs}>{children.length ? children : <br />}</p>;
    case "mathInline":
      return <KaTeXFormula source={String(node.attrs.source ?? "")} />;
    case "mathBlock":
      return <div {...attrs} className="nr-math-block"><KaTeXFormula source={String(node.attrs.source ?? "")} displayMode /> </div>;
    case "rawHtml": case "rawHtmlInline": {
      const source = String(node.attrs.source ?? "");
      if (/^<!--[\s\S]*-->$/.test(source.trim())) return null;
      return React.createElement(node.type.name === "rawHtml" ? "div" : "span", { ...attrs, className: "nr-raw-html" }, <code>{source}</code>);
    }
    case "htmlAnchor": return <a {...attrs} id={String(node.attrs.id)} data-document-anchor="" />;
    case "markdownImage": {
      const image = <span {...attrs} className="markdown-inline-image"><ReadonlyImage src={String(node.attrs.src || "")} alt={node.attrs.alt} title={node.attrs.title} width={node.attrs.width} /></span>;
      const link = node.marks.find(mark => mark.type.name === "link");
      return link ? readonlyLink(String(link.attrs.href ?? ""), link.attrs.title ?? undefined, image) : image;
    }
    case "htmlDetails":
      { const collapsed = state.collapsed ?? node.attrs.open !== true; return <details {...attrs} className="nr-details" open={!collapsed}>
        <summary className="nr-details-summary" onClick={event => { if (event.target instanceof Element && event.target.closest("button")) return; event.preventDefault(); update(pos, { ...state, collapsed: !collapsed }); }}>
          <span className="nr-details-fold-icon"><EditorFoldIcon scope="block" expanded={!collapsed} /></span>
          <span className="nr-details-title">{String(node.attrs.summary ?? "点击展开")}</span>
          <span className="nr-details-actions">
            <button type="button" title="复制折叠区块" aria-label="复制折叠区块" onClick={event => { event.preventDefault(); event.stopPropagation(); void copyToClipboard(`${String(node.attrs.summary ?? "点击展开")}\n\n${node.textBetween(0, node.content.size, "\n")}`); }}><ToolbarIcon name="copy" /></button>
            <button type="button" className="block-workspace-open" title="块模式" aria-label="块模式" data-workspace-position={pos}><ToolbarIcon name="expand" /></button>
          </span>
        </summary>
        <div className="nr-details-content">{children}</div>
      </details>; }
    case "footnotes":
      return <section {...attrs} className="nr-footnotes"><ol>{children}</ol></section>;
    case "footnoteDefinition":
      { const id = encodeURIComponent(String(node.attrs.id ?? "")); return <li {...attrs} id={`nr-footnote-${id}`} value={node.attrs.number ?? undefined} tabIndex={-1}><div data-footnote-content="">{children}</div>{Array.from({ length: Math.max(0, Number(node.attrs.references) || 0) }, (_, index) => <a key={index} className="nr-footnote-backref" href={`#nr-footnote-ref-${id}${index ? `-${index + 1}` : ""}`} aria-label={index ? `返回脚注引用 ${index + 1}` : "返回脚注引用"}>{index ? `↩${index + 1}` : "↩"}</a>)}</li>; }
    case "heading":
      return React.createElement(`h${node.attrs.level}`, attrs, children);
    case "bulletList":
      return <ul {...attrs} data-list-spread={node.attrs.spread ? "true" : undefined}>{children}</ul>;
    case "orderedList":
      return (
        <ol
          {...attrs}
          start={node.attrs.start}
          data-list-spread={node.attrs.spread ? "true" : undefined}
          style={
            Object.fromEntries(
              listStyle(node)
                .split(";")
                .map((item) => item.split(":")),
            ) as React.CSSProperties
          }
        >
          {children}
        </ol>
      );
    case "resizableImage":
    case "image":
      return <div {...attrs}><ReadonlyImage src={String(node.attrs.src || "")} alt={node.attrs.alt} title={node.attrs.title} width={node.attrs.width} /></div>;
    case "table":
      return <div {...attrs} className="tableWrapper"><table><tbody>{children}</tbody></table></div>;
    case "tableRow": return <tr>{children}</tr>;
    case "tableHeader": return <th colSpan={node.attrs.colspan} rowSpan={node.attrs.rowspan} style={{ textAlign: node.attrs.textAlign || undefined, backgroundColor: editorBackgroundStyle(node.attrs.backgroundColor) }}>{children}</th>;
    case "tableCell": return <td colSpan={node.attrs.colspan} rowSpan={node.attrs.rowspan} style={{ textAlign: node.attrs.textAlign || undefined, backgroundColor: editorBackgroundStyle(node.attrs.backgroundColor) }}>{children}</td>;
    case "listItem":
      return <li data-task-checked={typeof node.attrs.taskChecked === "boolean" ? String(node.attrs.taskChecked) : undefined}>{children}</li>;
    case "blockquote": {
      const collapsed = state.collapsed ?? node.attrs.collapsed === true;
      return (
        <blockquote
          {...attrs}
          className="blockquote-wrap" data-alert={node.attrs.alert || undefined}
          data-collapsed={String(collapsed)}
        >
          <BlockquoteToolbar alert={node.attrs.alert} text={node.textContent} collapsed={collapsed}
            position={pos} toggle={() => update(pos, { collapsed: !collapsed })} />
          {!collapsed && <div className="blockquote-content">{children}</div>}
        </blockquote>
      );
    }
    case "codeBlock": {
      const { collapsed, isMermaid, showDiagram, isFlow, showFlow, wrap } = codeBlockDisplay(node.attrs, state, defaultWrap);
      if (node.attrs.language === "toc") return <div {...attrs} className="toc-block-wrap"><TableOfContentsBlock source={node.textContent} collapsed={collapsed} onToggleCollapse={() => update(pos, { collapsed: !collapsed })} /></div>;
      const lineNumbers = codeLineNumbersEnabled();
      const lines = node.textContent.split("\n");
      let linePosition = pos + 1;
      return (
        <div
          {...attrs}
          className={`code-block-wrap ${isFlow ? "flow-block-wrap" : ""} ${collapsed ? "collapsed" : ""}`}
          data-code-wrap={String(wrap)}
        >
          <div className="vr-code-toolbar" contentEditable={false} data-diagram={(isMermaid && showDiagram || isFlow && showFlow) ? "true" : undefined}>
            <span className="structured-block-symbol" aria-hidden="true">{structuredBlockSymbol(node.attrs.language)}</span>
            <span className="structured-block-caption">{node.attrs.title || (isFlow ? "流程" : "代码")}</span>
            <span aria-label="代码语言">{CODE_LANGUAGE_OPTIONS.find(option => option.value === (normalizeCodeLanguage(node.attrs.language) ?? ""))?.label}</span>
            {isFlow && <button type="button" aria-label={showFlow ? "显示 Flow 源码" : "显示 Flow 流程"} aria-pressed={showFlow} onClick={() => update(pos, { diagram: !showFlow })}>{showFlow ? "源码" : "流程"}</button>}
            {isMermaid && <button type="button" aria-label={showDiagram ? "显示 Mermaid 源码" : "显示 Mermaid 图形"} aria-pressed={showDiagram} onClick={() => update(pos, { diagram: !showDiagram })}>{showDiagram ? "源码" : "图形"}</button>}
            {isMermaid && <span data-mermaid-controls hidden={!showDiagram || collapsed} />}
            <button hidden={isMermaid && showDiagram || isFlow && showFlow} type="button" aria-label={lineNumbers ? "隐藏代码行号" : "显示代码行号"} aria-pressed={lineNumbers} onClick={() => saveBlockWorkspacePreferences({ lineNumbers: !lineNumbers })}>行号</button>
            <button
              type="button"
              onClick={() => void copyToClipboard(node.textContent)}
            >
              {isFlow ? "复制流程源码" : "复制代码"}
            </button>
            <button
              type="button"
              aria-pressed={wrap}
              aria-label={wrap ? "关闭代码软换行" : "开启代码软换行"}
              hidden={isMermaid && showDiagram || isFlow && showFlow}
              onClick={() => update(pos, { wrap: !wrap })}
            >
              换行
            </button>
            <button type="button" className="block-workspace-open" data-workspace-position={pos} title={isFlow ? "放大阅读流程块" : "放大阅读代码块"} aria-label={isFlow ? "放大阅读流程块" : "放大阅读代码块"}><ToolbarIcon name="expand" /></button>
            <button
              type="button"
              aria-label={collapsed ? `展开${isFlow ? "流程" : "代码"}块` : `折叠${isFlow ? "流程" : "代码"}块`}
              aria-expanded={!collapsed}
              onClick={() => update(pos, { collapsed: !collapsed })}
            >
              <EditorFoldIcon scope="block" expanded={!collapsed} />
            </button>
          </div>
          {isFlow && <DeferredFlowBlock source={node.textContent} visible={showFlow && !collapsed} />}
          {isMermaid && <DeferredMermaidDiagram source={node.textContent} visible={showDiagram && !collapsed} />}
          {!collapsed && !showDiagram && !showFlow && (
            <div className="code-block-inner">
              <pre>
                <code>{lineNumbers ? lines.map((line, index) => {
                  const position = linePosition;
                  linePosition += line.length + 1;
                  return <span className="vr-code-line" key={index} style={{ gridTemplateColumns: `calc(${String(lines.length).length}ch + var(--code-line-number-padding, 8px)) minmax(0, 1fr)` }}>
                    <span className="vr-code-line-number" aria-hidden="true">{index + 1}</span>
                    <span>{line ? renderReadonlyBlock(node.type.schema.text(line), position, states, update, match, defaultWrap, false, false) : "\n"}</span>
                  </span>;
                }) : children}</code>
              </pre>
            </div>
          )}
        </div>
      );
    }
    default:
      return null; // The capability gate rejects unknown nodes before mounting.
  }
}

export function ReadonlyVirtualNote(
  props: NoteEditorProps & { doc: PMNode; onFallback: (selectAll?: boolean) => void },
) {
  const {
    doc,
    noteId,
    contentVersion = "",
    onFallback,
    onOutlineAvailabilityChange,
    onStickyTitleChange,
    searchTarget,
    onSearchTargetConsumed,
  } = props;
  const statusBar = useStatusBarDisplay(props.showStatusBar, props.focusMode);
  const active = useDocumentActive();
  const outlineDisplayConfig = usePanelDisplay("document-outline");
  const bookmarkDisplayConfig = usePanelDisplay("bookmarks");
  const [annotations, setAnnotations] = useState<ReadingAnnotation[]>([]);
  const bookmarkPanelLabel = READING_ANNOTATIONS_ENABLED ? "书签与标注" : "书签";
  const [annotationContext, setAnnotationContext] = useState<{ x: number; y: number; from: number; to: number } | null>(null);
  const [annotationPopover, setAnnotationPopover] = useState<{ id: string; left: number; top: number } | null>(null);
  const annotationLeaveTimer = useRef<number | null>(null);
  const lastAnnotationSelection = useRef<{ from: number; to: number } | null>(null);
  const bookmarkDisplayListRef = useRef<HTMLDivElement>(null);
  const documentHover = useDocumentHoverPreview(() => doc);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<number, number>());
  const pendingAnchor = useRef<ReadingAnchor | null>(null);
  const pendingNavigationRequest = useRef<number | null>(null);
  const pendingMatch = useRef<SearchMatch | null>(null);
  const pendingBlockJump = useRef<number | null>(null);
  const pendingFootnote = useRef<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!READING_ANNOTATIONS_ENABLED) {
      setAnnotations([]);
      return () => { cancelled = true; };
    }
    void listReadingAnnotations(noteId).then(async stored => {
      if (cancelled) return;
      const result = reanchorReadingAnnotations(doc, stored);
      await Promise.all([
        ...result.updates.map(item => putReadingAnnotation(item)),
        deleteReadingAnnotations(result.removed),
      ]);
      if (!cancelled) setAnnotations(result.updates);
    }).catch(error => {
      if (!cancelled) setNotice(error instanceof Error ? error.message : "阅读标注加载失败");
    });
    return () => { cancelled = true; };
  }, [noteId, doc]);
  useEffect(() => {
    if (!READING_ANNOTATIONS_ENABLED || !props.readonly) return;
    const captureSelection = () => {
      const root = bodyRef.current;
      const range = root && selectedReadonlyRange(root);
      if (range) lastAnnotationSelection.current = range;
    };
    document.addEventListener("selectionchange", captureSelection);
    return () => document.removeEventListener("selectionchange", captureSelection);
  }, [props.readonly, noteId]);
  useEffect(() => {
    const sync = () => setRevision(value => value + 1);
    window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [folds, setFolds] = useState(
    () => new Set(props.sensitive ? [] : sessionHeadingFoldStore.load(noteId)?.collapsedKeys ?? []),
  );
  const states = useMemo(() => props.sensitive ? new Map<number, BlockState>() : readingBlockSession(noteId, props.readingBlockVersion ?? contentVersion), [noteId, contentVersion, props.readingBlockVersion, props.sensitive]);
  const sections = useMemo(() => extractHeadingSections(doc), [doc]);
  const outlinePaths = useMemo(() => {
    if (outlineDisplayConfig?.tooltip !== "path") return [];
    const path: string[] = [];
    return sections.map(heading => {
      path.length = heading.level - 1;
      path[heading.level - 1] = outlineLabel(heading.text, 500);
      return path.filter(Boolean).join(" / ");
    });
  }, [sections, outlineDisplayConfig?.tooltip]);
  const presentationLevel = flowHeadingLevel(props.content.metadata);
  const flowAttributes = useMemo(() => flowBlockAttributes(doc, presentationLevel), [doc, presentationLevel]);
  const followupBlocks = useMemo(() => listFollowupBlocks(doc), [doc]);
  const sectionByPos = useMemo(
    () => new Map(sections.map((section) => [section.pos, section])),
    [sections],
  );
  const blocks = useMemo(() => readingBlocks(doc, folds), [doc, folds]);
  // revision invalidates the mutable measurement cache without rebuilding on scroll.
  const layout = useMemo(
    () => new ReadingLayout(blocks, heights.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blocks, revision],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const mobileDrawerViewport = useMobileViewport();
  const desktopPanels = useDesktopDocumentPanels(!mobileDrawerViewport, sections, props.content.metadata?.bookmarks, annotations);
  const { openPreview, dismiss: dismissPreview, toggle: togglePinnedPanel } = desktopPanels;
  const [panel, setPanel] = useState<"outline" | "bookmarks" | "search" | null>(
    null,
  );
  const lastMobilePanel = useRef<"outline" | "bookmarks">("outline");
  const [presentation, setPresentation] = useState<"popover" | "drawer">(
    "popover",
  );
  const openPanel = useCallback((next: typeof panel, drawer = false) => {
    setPresentation(drawer ? "drawer" : "popover");
    if (next === "outline" || next === "bookmarks") lastMobilePanel.current = next;
    if (!mobileDrawerViewport && (next === "outline" || next === "bookmarks")) {
      setPanel(null);
      openPreview(next === "outline" ? "outline" : "bookmark");
    } else { dismissPreview(); setPanel(next); }
  }, [mobileDrawerViewport, openPreview, dismissPreview]);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  useEffect(() => {
    if (!active) { setQuery(""); setMatchIndex(0); setPanel(null); }
  }, [active]);
  const matches = useMemo(() => findSearchMatches(doc, query), [doc, query]);
  const [referenceMatch, setReferenceMatch] = useState<SearchMatch | undefined>();
  const activeMatch = referenceMatch ?? matches[matchIndex];
  useEffect(() => {
    if (!referenceMatch) return;
    const timer = window.setTimeout(() => setReferenceMatch(undefined), 1400);
    return () => window.clearTimeout(timer);
  }, [referenceMatch]);
  const [selectionWindow, setSelectionWindow] = useState<
    [number, number] | null
  >(null);
  const selectedBlocks = useRef<[number, number] | null>(null);
  const copyPosition = useRef<number | null>(null);
  const [notice, setNotice] = useState("");
  const [blockMenu, setBlockMenu] = useState<{ position: number; number: number; trigger: HTMLButtonElement; doc: PMNode } | null>(null);
  const [currentNumber, setCurrentNumber] = useState(1);
  const reportSelection = useRef(props.onHostSelection);
  reportSelection.current = props.onHostSelection;
  useEffect(() => {
    const block = blocks.find(block => block.number === currentNumber);
    if (block) {
      const saved = copyPosition.current;
      const position = saved !== null && saved >= block.pos && saved < block.pos + block.node.nodeSize ? saved : block.pos;
      reportSelection.current?.({ from: position, to: position });
    }
  }, [blocks, currentNumber]);
  const { relativeBlockNumbers, relativeBlockNumberAlignment } = useRelativeNumbering();
  const visibleNumbers = useMemo(() => relativeBlockNumbers ? blocks.map(block => block.number) : [], [blocks, relativeBlockNumbers]);
  const closeBlockMenu = useCallback(() => setBlockMenu(null), []);
  useEffect(() => { setBlockMenu(null); }, [doc, active]);
  useEffect(() => {
    if (!notice.startsWith("已复制")) return;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const scrollBusy = useRef(false);
  const touchDown = useRef(false);
  const savedAnchor = useRef<ReadingAnchor>({ position: 0, offset: 0 });
  const initialContentVersion = useRef(contentVersion);
  const anchorKey = `nr:readonlyAnchor:${noteId}`;
  const capture = useCallback((): ReadingAnchor => {
    const root = rootRef.current;
    const current = layoutRef.current;
    const inset = bodyRef.current ? Number.parseFloat(getComputedStyle(bodyRef.current).paddingTop) || 0 : 0;
    const top = (root?.scrollTop ?? 0) - inset;
    const index = current.atOffset(Math.max(0, top));
    return {
      position: current.blocks[index]?.pos ?? 0,
      offset: top - current.offsets[index],
    };
  }, []);
  useEffect(() => {
    if (!relativeBlockNumbers) return;
    const position = Math.min(doc.content.size, copyPosition.current ?? capture().position);
    setCurrentNumber(Math.min(doc.childCount, doc.resolve(position).index(0) + 1));
  }, [relativeBlockNumbers, doc, capture]);
  const preserve = useCallback(() => {
    pendingAnchor.current = capture();
  }, [capture]);
  const previousFocus = useRef(props.focusMode);
  useEffect(() => {
    const invalidateTypography = () => {
      if (!rootRef.current || heights.current.size === 0) return;
      if (!pendingAnchor.current && active && rootRef.current.isConnected && rootRef.current.clientWidth > 0 && rootRef.current.clientHeight > 0) preserve();
      heights.current.clear();
      setRevision(value => value + 1);
    };
    window.addEventListener(READING_TYPOGRAPHY_WILL_CHANGE, invalidateTypography);
    return () => window.removeEventListener(READING_TYPOGRAPHY_WILL_CHANGE, invalidateTypography);
  }, [active, preserve]);
  useLayoutEffect(() => {
    if (previousFocus.current !== props.focusMode) {
      previousFocus.current = props.focusMode;
      // Layout classes have already changed here. Capture before reflow via
      // the last reading anchor, rather than a newly clamped scroll offset.
      pendingAnchor.current = savedAnchor.current;
      scrollBusy.current = false;
    } else preserve();
    heights.current.clear();
    setRevision((value) => value + 1);
  }, [
    props.editorFontSize,
    props.cjkLatinSpacing,
    props.showLineNumbers,
    props.focusMode,
    preserve,
  ]);
  const jump = useCallback(
    (position: number, offset = 0, match?: SearchMatch) => {
      useNavigationStore.getState().record({ noteId, from: position, to: position }, true);
      setCurrentNumber(Math.min(doc.childCount, doc.resolve(position).index(0) + 1));
      // Explicit navigation supersedes an earlier scroll-settle timer. Native
      // inertia tracking must not swallow search/bookmark/button requests.
      scrollBusy.current = false;
      pendingAnchor.current = { position, offset };
      pendingMatch.current = match ?? null;
      doc.descendants((node, pos) => {
        if (position < pos || position >= pos + node.nodeSize) return false;
        if (
          position >= pos &&
          (node.type.name === "blockquote" || node.type.name === "codeBlock" || node.type.name === "htmlDetails")
        )
          states.set(pos, { ...states.get(pos), collapsed: false });
        return true;
      });
      setFolds((current) => {
        const next = new Set(current);
        for (const section of sections)
          if (position >= section.headingEnd && position < section.end)
            next.delete(section.key);
        return next;
      });
      setRevision((value) => value + 1);
    },
    [sections, doc, states, noteId],
  );
  const revealAnnotation = useCallback((annotation: ReadingAnnotation, anchor?: HTMLElement | null) => {
    if (annotationLeaveTimer.current !== null) window.clearTimeout(annotationLeaveTimer.current);
    const rect = anchor?.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 24);
    setAnnotationPopover({
      id: annotation.id,
      left: Math.max(12, Math.min(rect?.left ?? window.innerWidth / 2 - width / 2, window.innerWidth - width - 12)),
      top: Math.max(12, Math.min((rect?.bottom ?? 80) + 6, window.innerHeight - 180)),
    });
  }, []);
  const handleAnnotationPointerOver = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!READING_ANNOTATIONS_ENABLED) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-reading-annotation]") : null;
    if (!target) return;
    const item = annotations.find(annotation => annotation.id === target.dataset.readingAnnotation);
    if (item) revealAnnotation(item, target);
  }, [annotations, revealAnnotation]);
  const handleAnnotationPointerOut = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-reading-annotation]") : null;
    const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (!target || related?.closest(`[data-reading-annotation="${target.dataset.readingAnnotation}"]`) || related?.closest(".reading-annotation-bubble")) return;
    if (annotationLeaveTimer.current !== null) window.clearTimeout(annotationLeaveTimer.current);
    annotationLeaveTimer.current = window.setTimeout(() => setAnnotationPopover(current => current?.id === target.dataset.readingAnnotation ? null : current), 180);
  }, []);
  useEffect(() => () => { if (annotationLeaveTimer.current !== null) window.clearTimeout(annotationLeaveTimer.current); }, []);
  const addAnnotation = useCallback(async (range: { from: number; to: number }) => {
    if (!READING_ANNOTATIONS_ENABLED) return;
    if (!props.readonly || annotations.some(item => range.from < item.to && range.to > item.from)) {
      setNotice("该范围已有阅读标注");
      return;
    }
    try {
      const annotation = createReadingAnnotation(noteId, doc, range.from, range.to);
      await putReadingAnnotation(annotation);
      setAnnotations(current => [...current, annotation].sort((a, b) => a.from - b.from));
      setAnnotationContext(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "创建阅读标注失败"); }
  }, [annotations, doc, noteId, props.readonly]);
  const updateAnnotation = useCallback(async (id: string, note: string) => {
    const current = annotations.find(item => item.id === id);
    if (!current) return;
    const updated = { ...current, note: note.trim(), updatedAt: new Date().toISOString() };
    await putReadingAnnotation(updated);
    setAnnotations(items => items.map(item => item.id === id ? updated : item));
  }, [annotations]);
  const removeAnnotation = useCallback(async (id: string) => {
    await deleteReadingAnnotation(id);
    setAnnotations(items => items.filter(item => item.id !== id));
    setAnnotationPopover(current => current?.id === id ? null : current);
  }, []);
  const navigationTarget = useNavigationStore(state => state.target?.noteId === noteId ? state.target : null);
  const navigateHeading = useCallback((item: { pos: number }) => {
    pendingBlockJump.current = item.pos;
    jump(item.pos);
  }, [jump]);
  useEffect(() => {
    if (!active) return;
    const history = useNavigationStore.getState();
    history.activate(noteId);
    const position = capture().position;
    history.record({ noteId, from: position, to: position });
  }, [noteId, capture, active]);
  useEffect(() => {
    if (!navigationTarget || !active) return;
    pendingNavigationRequest.current = navigationTarget.requestId;
    jump(Math.max(0, Math.min(navigationTarget.from, doc.content.size)));
  }, [navigationTarget, jump, doc, active]);
  const fallback = useCallback(() => {
    handoffReadingAnchor(noteId, capture());
    onFallback();
  }, [capture, noteId, onFallback]);
  const updateBlock = (pos: number, value: BlockState) => {
    scrollBusy.current = false;
    preserve();
    states.set(pos, { ...states.get(pos), ...value });
    setRevision((current) => current + 1);
  };
  const toggleHeading = (pos: number) => {
    const section = sectionByPos.get(pos);
    if (!section || section.end <= section.headingEnd) return;
    scrollBusy.current = false;
    preserve();
    setFolds((current) => {
      const next = new Set(current);
      if (next.has(section.key)) next.delete(section.key);
      else next.add(section.key);
      return next;
    });
  };
  useEffect(() => {
    if (props.sensitive) return;
    sessionHeadingFoldStore.save(noteId, {
      version: 1,
      collapsedKeys: [...folds],
    });
  }, [noteId, folds, props.sensitive]);
  useEffect(() => {
    onOutlineAvailabilityChange?.(sections.length > 0);
    onStickyTitleChange?.(null);
  }, [onOutlineAvailabilityChange, onStickyTitleChange, sections.length]);

  useLayoutEffect(() => {
    let initial = takeReadingAnchor(noteId);
    if (!initial && !props.sensitive) {
      try {
        const saved = readReadingState(noteId).virtual;
        const stored = saved ? { ...saved, version: saved.revision } : JSON.parse(localStorage.getItem(anchorKey) ?? "null");
        if (
          stored?.version === initialContentVersion.current &&
          Number.isFinite(stored.position) &&
          Number.isFinite(stored.offset)
        )
          initial = stored;
      } catch {
        /* malformed or unavailable browser storage */
      }
    }
    // Restoring a viewport is not explicit navigation into a folded block.
    // Preserve code/quote/details state; only user-requested jumps reveal it.
    if (initial) {
      pendingAnchor.current = initial;
      if (initial.selection !== undefined) {
        const position = Math.max(0, Math.min(doc.content.size, initial.selection));
        copyPosition.current = position;
        setCurrentNumber(Math.min(doc.childCount, doc.resolve(position).index(0) + 1));
      }
    }
  }, [anchorKey, jump, noteId, props.sensitive, doc]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (pendingAnchor.current && !scrollBusy.current) {
      const anchor = pendingAnchor.current;
      const index = layout.atPosition(anchor.position);
      const inset = bodyRef.current ? Number.parseFloat(getComputedStyle(bodyRef.current).paddingTop) || 0 : 0;
      root.scrollTop = Math.max(0, inset + layout.offsets[index] + anchor.offset);
      pendingAnchor.current = null;
      const requestId = pendingNavigationRequest.current;
      if (requestId !== null) {
        pendingNavigationRequest.current = null;
        useNavigationStore.getState().consumed(requestId);
      }
    }
    setViewport((current) =>
      current.top === root.scrollTop && current.height === root.clientHeight
        ? current
        : { top: root.scrollTop, height: root.clientHeight },
    );
    savedAnchor.current = capture();
  }, [layout, capture]);

  useEffect(() => {
    const root = rootRef.current!;
    let frame = 0,
      timer = 0;
    let width = root.clientWidth;
    const persist = () => {
      if (props.sensitive) return;
      const anchor = savedAnchor.current;
      patchReadingState(noteId, { virtual: { ...anchor, revision: contentVersion } });
      try {
        localStorage.setItem(
          anchorKey,
          JSON.stringify({ ...anchor, version: contentVersion }),
        );
      } catch {
        /* best effort */
      }
    };
    const captureAndPersist = () => {
      if (root.isConnected && !root.closest("[inert]") && root.clientHeight > 0 && !pendingAnchor.current)
        savedAnchor.current = capture();
      persist();
    };
    const settle = () => {
      if (touchDown.current || !root.isConnected || root.closest("[inert]")) return;
      scrollBusy.current = false;
      // User scrolling wins over a deferred geometry correction.
      pendingAnchor.current = null;
      savedAnchor.current = capture();
      persist();
    };
    const scroll = () => {
      if (!root.isConnected || root.closest("[inert]")) return;
      // Capture before the next frame: a document switch can cancel that frame.
      savedAnchor.current = capture();
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          setViewport({ top: root.scrollTop, height: root.clientHeight });
          savedAnchor.current = capture();
        });
      clearTimeout(timer);
      timer = window.setTimeout(settle, 180);
    };
    const start = () => {
      touchDown.current = true;
      scrollBusy.current = true;
    };
    const end = () => {
      touchDown.current = false;
      clearTimeout(timer);
      timer = window.setTimeout(settle, 180);
    };
    const wheel = () => {
      scrollBusy.current = true;
      clearTimeout(timer);
      timer = window.setTimeout(settle, 180);
    };
    const resize = new ResizeObserver(() => {
      if (root.clientWidth <= 0 || root.clientHeight <= 0) return;
      if (root.clientWidth !== width) {
        if (!pendingAnchor.current) preserve();
        width = root.clientWidth;
        heights.current.clear();
        setRevision((value) => value + 1);
      }
      setViewport({ top: root.scrollTop, height: root.clientHeight });
    });
    resize.observe(root);
    root.addEventListener("scroll", scroll, { passive: true });
    root.addEventListener("wheel", wheel, { passive: true });
    root.addEventListener("touchstart", start, { passive: true });
    root.addEventListener("touchend", end, { passive: true });
    root.addEventListener("touchcancel", end, { passive: true });
    window.addEventListener("pagehide", captureAndPersist);
    window.addEventListener("beforeunload", captureAndPersist);
    window.addEventListener(READING_POSITION_FLUSH_EVENT, captureAndPersist);
    document.addEventListener("visibilitychange", persist);
    return () => {
      persist();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      resize.disconnect();
      root.removeEventListener("scroll", scroll);
      root.removeEventListener("wheel", wheel);
      root.removeEventListener("touchstart", start);
      root.removeEventListener("touchend", end);
      root.removeEventListener("touchcancel", end);
      window.removeEventListener("pagehide", captureAndPersist);
      window.removeEventListener("beforeunload", captureAndPersist);
      window.removeEventListener(READING_POSITION_FLUSH_EVENT, captureAndPersist);
      document.removeEventListener("visibilitychange", persist);
    };
  }, [anchorKey, contentVersion, capture, preserve, noteId, props.sensitive]);

  const windowRange = layout.window(viewport.top, viewport.height);
  const start = selectionWindow
    ? Math.min(windowRange[0], selectionWindow[0])
    : windowRange[0];
  const end = Math.min(
    blocks.length,
    selectionWindow
      ? Math.max(windowRange[1], selectionWindow[1])
      : windowRange[1],
  );
  useLayoutEffect(() => {
    const body = bodyRef.current!;
    const measure = () => {
      const changes: [number, number][] = [];
      const toolbarCenters: [HTMLElement, string][] = [];
      for (const row of body.querySelectorAll<HTMLElement>(
        "[data-reading-row]",
      )) {
        const pos = Number(row.dataset.position);
        const rowRect = row.getBoundingClientRect();
        const height = rowRect.height;
        if (row.dataset.blockType === "codeBlock") {
          const toolbar = row.querySelector<HTMLElement>(".vr-code-toolbar, .document-toc-block > header");
          if (toolbar) {
            const title = toolbar.querySelector<HTMLElement>(".structured-block-caption, strong");
            const rect = (title ?? toolbar).getBoundingClientRect();
            const center = `${rect.top - rowRect.top + rect.height / 2}px`;
            if (row.style.getPropertyValue("--vr-block-toolbar-center") !== center) toolbarCenters.push([row, center]);
          }
        }
        if (
          height > 0 &&
          Math.abs((heights.current.get(pos) ?? -1) - height) > 0.5
        )
          changes.push([pos, height]);
      }
      for (const [row, center] of toolbarCenters) row.style.setProperty("--vr-block-toolbar-center", center);
      if (!changes.length) return;
      if (!pendingAnchor.current && !scrollBusy.current) preserve();
      for (const [pos, height] of changes) heights.current.set(pos, height);
      setRevision((value) => value + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const row of body.querySelectorAll("[data-reading-row]"))
      observer.observe(row);
    return () => observer.disconnect();
  }, [
    start,
    end,
    blocks,
    props.editorFontSize,
    props.showLineNumbers,
    preserve,
  ]);

  useLayoutEffect(() => {
    const id = pendingFootnote.current;
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!id || !root || !body) return;
    const target = findFootnoteElement(body, id);
    if (!target) return;
    const row = target.closest<HTMLElement>("[data-reading-row]");
    if (!row) return;
    const previousTop = root.scrollTop;
    const rect = target.getBoundingClientRect();
    centerSearchMatch(root, rect);
    target.focus({ preventScroll: true });
    const offset = root.scrollTop - previousTop + root.getBoundingClientRect().top - row.getBoundingClientRect().top;
    pendingAnchor.current = { position: Number(row.dataset.position), offset };
    savedAnchor.current = pendingAnchor.current;
    pendingFootnote.current = null;
    setViewport({ top: root.scrollTop, height: root.clientHeight });
  }, [start, end, layout]);

  useLayoutEffect(() => {
    const position = pendingBlockJump.current;
    const root = rootRef.current;
    if (position === null || !root) return;
    const block = layout.blocks[layout.atPosition(position)];
    const row = block && bodyRef.current?.querySelector<HTMLElement>(`[data-reading-row][data-position="${block.pos}"]`);
    if (!row) return;
    // Estimated heights can shift during mounting. Refine the explicit bookmark/heading
    // destination once its real row is available, then preserve that viewport.
    const rowRect = row.getBoundingClientRect();
    const previousTop = root.scrollTop;
    centerSearchMatch(root, rowRect);
    const offset = root.scrollTop - previousTop + root.getBoundingClientRect().top - rowRect.top;
    pendingAnchor.current = { position: block.pos, offset };
    savedAnchor.current = pendingAnchor.current;
    pendingBlockJump.current = null;
    setViewport({ top: root.scrollTop, height: root.clientHeight });
  }, [start, end, layout]);

  useLayoutEffect(() => {
    const target = pendingMatch.current;
    if (!target || activeMatch?.from !== target.from) return;
    const mark = bodyRef.current?.querySelector<HTMLElement>(
      "mark.search-match-active",
    );
    const row = mark?.closest<HTMLElement>("[data-reading-row]");
    const root = rootRef.current;
    if (!mark || !row || !root) return;
    // Resolve text geometry after mounting, including matches deep inside a
    // paragraph or a previously collapsed quote/code block.
    const rect = mark.getClientRects()[0] ?? mark.getBoundingClientRect();
    const rowTop = row.getBoundingClientRect().top;
    const rootTop = root.getBoundingClientRect().top;
    const previousTop = root.scrollTop;
    centerSearchMatch(root, rect);
    // 后续块高度测量仍以实际滚动位置为锚点，避免把居中的命中拉回顶部。
    const offset = root.scrollTop - previousTop + rootTop - rowTop;
    pendingAnchor.current = { position: Number(row.dataset.position), offset };
    pendingMatch.current = null;
    savedAnchor.current = pendingAnchor.current;
    setViewport({ top: root.scrollTop, height: root.clientHeight });
  }, [activeMatch, start, end, layout]);

  useEffect(() => {
    // Retain every rendered block once a native range exists. Never recycle its
    // anchor/focus DOM; expanding a selection grows this pinned contiguous range.
    const select = () => {
      const selection = window.getSelection();
      const node = selection?.focusNode;
      const element = node instanceof Element ? node : node?.parentElement;
      const row = element?.closest<HTMLElement>("[data-reading-row]");
      if (relativeBlockNumbers && row && bodyRef.current?.contains(row)) setCurrentNumber(Number(row.dataset.blockNumber));
      const inside =
        selection &&
        !selection.isCollapsed &&
        bodyRef.current?.contains(selection.anchorNode);
      if (!inside) {
        selectedBlocks.current = null;
        setSelectionWindow(null);
        return;
      }
      const previous = selectedBlocks.current;
      const range: [number, number] = [
        Math.min(previous?.[0] ?? start, start),
        Math.max(previous?.[1] ?? end, end),
      ];
      selectedBlocks.current = range;
      setSelectionWindow(range);
    };
    document.addEventListener("selectionchange", select);
    return () => document.removeEventListener("selectionchange", select);
  }, [start, end, relativeBlockNumbers]);
  useEffect(() => {
    if (!selectionWindow) return;
    if (start < selectionWindow[0] || end > selectionWindow[1]) {
      selectedBlocks.current = [start, end];
      setSelectionWindow([start, end]);
    }
  }, [start, end, selectionWindow]);

  const lastOutline = useRef(props.outlineRequestId);
  const lastBookmark = useRef(props.bookmarkRequestId);
  useEffect(() => {
    if (props.outlineRequestId !== lastOutline.current) {
      lastOutline.current = props.outlineRequestId;
      openPanel("outline");
    }
    if (props.bookmarkRequestId !== lastBookmark.current) {
      lastBookmark.current = props.bookmarkRequestId;
      openPanel("bookmarks");
    }
  }, [props.outlineRequestId, props.bookmarkRequestId, openPanel]);
  useEffect(() => {
    const target = searchTarget;
    if (!target || target.noteId !== noteId) return;
    if (target.referenceId) {
      const anchor = props.content.metadata?.referenceAnchors?.find(item => item.id === target.referenceId && !item.deleted);
      if (anchor) {
        const match = anchor.kind === "range" ? { from: anchor.from, to: anchor.to } : undefined;
        setReferenceMatch(match);
        pendingBlockJump.current = match ? null : anchor.from;
        jump(anchor.from, 0, match);
      }
      else setNotice("引用目标已删除或不存在");
      onSearchTargetConsumed?.(target.requestId);
      return;
    }
    if (target.bookmarkId) {
      const bookmark = props.content.metadata?.bookmarks?.find(item => item.id === target.bookmarkId);
      if (bookmark) {
        pendingBlockJump.current = bookmark.position;
        jump(bookmark.position);
      }
      onSearchTargetConsumed?.(target.requestId);
      return;
    }
    const found = findSearchMatches(doc, target.query);
    setReferenceMatch(undefined);
    setQuery(target.query);
    setMatchIndex(0);
    openPanel("search");
    if (found[0]) jump(found[0].from, 0, found[0]);
    onSearchTargetConsumed?.(target.requestId);
  }, [searchTarget, onSearchTargetConsumed, doc, noteId, jump, openPanel, props.content.metadata?.bookmarks, props.content.metadata?.referenceAnchors]);

  const outlineTriggerRef = useRef<HTMLButtonElement>(null);
  const bookmarkTriggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const preview = active ? (mobileDrawerViewport ? panel : desktopPanels.preview === "bookmark" ? "bookmarks" : desktopPanels.preview) : null;
  const documentPanelStyle = useDocumentPanelPosition({
    open: (preview === "outline" || preview === "bookmarks") && (!mobileDrawerViewport || presentation === "popover"),
    triggerRef: preview === "bookmarks" ? bookmarkTriggerRef : outlineTriggerRef,
    panelRef, compact: mobileDrawerViewport, layoutKey: `${props.focusMode}:${preview}`,
    width: mobileDrawerViewport ? 380 : desktopPanels.widths[preview === "bookmarks" ? "bookmark" : "outline"],
  });
  const onOpenSettings = props.onOpenSettings;
  useEffect(
    () =>
      bindViewportEdgeSwipe("right", (touch) => {
        if (!active || !mobileDrawerViewport) return null;
        const viewport = swipeViewport();
        if (touch.clientY >= viewport.middleY) return onOpenSettings ?? null;
        const target = lastMobilePanel.current;
        if (target === "outline" && sections.length === 0) return () => openPanel("bookmarks", true);
        return () => openPanel(target, true);
      }),
    [active, mobileDrawerViewport, sections.length, openPanel, onOpenSettings],
  );
  const [blockJumpValue, setBlockJumpValue] = useState<string | null>(null);
  const [blockJumpError, setBlockJumpError] = useState("");
  const blockJumpInput = useRef<HTMLInputElement>(null);
  const blockJumpOpen = blockJumpValue !== null;
  useEffect(() => {
    if (blockJumpOpen) {
      blockJumpInput.current?.focus({ preventScroll: true });
      blockJumpInput.current?.select();
    }
  }, [blockJumpOpen]);
  const closeBlockJump = () => {
    setBlockJumpValue(null);
    bodyRef.current?.focus({ preventScroll: true });
  };
  const submitBlockJump = () => {
    const number = Number(blockJumpValue);
    if (!/^\d+$/.test(blockJumpValue?.trim() ?? "") || number < 1 || number > doc.childCount) {
      setBlockJumpError(`请输入 1–${doc.childCount}`);
      return;
    }
    doc.forEach((_node, pos, index) => {
      if (index === number - 1) navigateHeading({ pos });
    });
    closeBlockJump();
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!active || event.defaultPrevented || rootRef.current?.closest("[inert]")) return;
      if (event.isComposing || event.keyCode === 229) return;
      if (event.target instanceof Element && event.target.closest(".settings-overlay, .block-workspace, .pdf-reader")) return;
      if (isEditorLineJumpKeyEvent(event)) {
        event.preventDefault();
        event.stopPropagation();
        if (blockJumpValue !== null) {
          setBlockJumpValue(null);
          bodyRef.current?.focus({ preventScroll: true });
        } else {
          const position = capture().position;
          let number = 1;
          doc.forEach((_node, pos, index) => { if (pos <= position) number = index + 1; });
          setPanel(null);
          setBlockJumpError("");
          setBlockJumpValue(String(number));
        }
        return;
      }
      if (isDocumentFindKeyEvent(event)) {
        setBlockJumpValue(null);
        event.preventDefault();
        event.stopPropagation();
        openPanel("search");
      }
      if (event.key === "Escape") {
        if ([...document.querySelectorAll('[role="dialog"], [role="menu"], dialog[open], .builtin-plugin-notice')]
          .some(element => element.getClientRects().length > 0)) return;
        if (query) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setQuery("");
          setMatchIndex(0);
        }
        setPanel(null);
        if (blockJumpValue !== null) {
          event.preventDefault();
          setBlockJumpValue(null);
          bodyRef.current?.focus({ preventScroll: true });
        }
      }
      if (
        isPrimaryShortcutModifier(event) &&
        !event.altKey && !event.shiftKey && !event.isComposing &&
        event.key.toLowerCase() === "a" &&
        !(event.target instanceof Element && event.target.closest("input, textarea, select, [role=menu], dialog")) &&
        (event.target === document.body || bodyRef.current?.contains(event.target as Node)) &&
        (bodyRef.current?.contains(document.activeElement) || bodyRef.current?.contains(window.getSelection()?.anchorNode ?? null) || bodyRef.current?.matches(":hover"))
      ) {
        event.preventDefault();
        event.stopPropagation();
        // Unmounted rows cannot participate in native selection. Switch to the
        // complete renderer before selecting the whole document.
        handoffReadingAnchor(noteId, capture());
        onFallback(true);
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [active, query, openPanel, capture, noteId, onFallback, blockJumpValue, doc]);
  const lastDoubleFold = useRef<{ time: number; number: number } | null>(null);
  const tap = useRef<{
    pos: number;
    time: number;
    x: number;
    y: number;
  } | null>(null);
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const bookmarks = props.content.metadata?.bookmarks ?? [];
  const annotationPanelItems = sortedPanelItems([
    ...bookmarks.map(item => ({ kind: "bookmark" as const, id: item.id, position: item.position, text: item.label || item.preview || "书签", date: item.createdAt, bookmark: item })),
    ...annotations.map(item => ({ kind: "annotation" as const, id: item.id, position: item.from, text: item.note || item.exact, date: item.createdAt, annotation: item })),
  ], bookmarkDisplayConfig, item => item.text, item => item.date, item => item.id);
  const annotationTotal = bookmarks.length + annotations.length;
  const { onBookmarkCountChange } = props;
  useEffect(() => { onBookmarkCountChange?.(bookmarks.length); }, [onBookmarkCountChange, bookmarks.length]);
  useEffect(() => () => onBookmarkCountChange?.(0), [onBookmarkCountChange]);
  const blockMenuActions = (): BlockMenuAction[] => {
    if (!blockMenu || blockMenu.doc !== doc) return [];
    const pos = blockMenu.position, node = doc.nodeAt(pos);
    if (!node) return [];
    const bookmark = bookmarks.find(item => item.position >= pos && item.position < pos + node.nodeSize);
    const actions: BlockMenuAction[] = [
      ...(["formatted", "markdown", "text"] as const).map((mode, index) => ({ label: ["复制内容", "复制 Markdown", "复制纯文本"][index], run: () => { void copyDocumentBlock(doc, pos, mode).then(() => setNotice("已复制此块"), () => setNotice("复制块失败，请重试")); } })),
      { label: "复制块引用", run: () => {
        const anchor = referenceAnchorAt(doc, "block", pos);
        const existing = props.content.metadata?.referenceAnchors ?? [];
        const reused = existing.find(item => !item.deleted && item.kind === anchor.kind && item.from === anchor.from && item.to === anchor.to);
        const target = reused ?? anchor;
        if (!reused) props.onContentChange(() => ({ ...props.content, metadata: { ...props.content.metadata, referenceAnchors: [...existing, anchor] } }), { metadataOnly: true });
        void copyToClipboard(deltaToMarkdown({ ops: [{ insert: target.preview, attributes: { link: `nr-note://${noteId}#nr-ref-${target.id}` } }, { insert: "\n" }] }), { reportFailure: true, beforeCopy: () => props.onFlush?.() ?? Promise.resolve() }).then(() => setNotice("已复制引用，可粘贴到任意文档"), () => setNotice("复制引用失败，请重试"));
      } },
      { label: bookmark ? "取消块书签" : "添加块书签", disabled: !bookmark && node.isLeaf, run: () => {
        const next = bookmark ? bookmarks.filter(item => item.id !== bookmark.id) : [...bookmarks, { id: crypto.randomUUID(), position: pos + (node.isTextblock ? 1 : 0), preview: node.textContent.slice(0, 120), createdAt: new Date().toISOString() }];
        props.onContentChange(() => ({ ...props.content, metadata: { ...props.content.metadata, bookmarks: next } }), { metadataOnly: true });
      } },
      { label: "打开块模式", run: () => { queueBlockWorkspace(noteId, pos); fallback(); } },
    ];
    if (sectionByPos.has(pos)) actions.push({ label: "折叠 / 展开本节", run: () => toggleHeading(pos) });
    else if (["codeBlock", "blockquote", "htmlDetails"].includes(node.type.name)) actions.push({ label: "折叠 / 展开此块", run: () => updateBlock(pos, { collapsed: !(states.get(pos)?.collapsed ?? (node.type.name === "htmlDetails" ? node.attrs.open !== true : node.attrs.collapsed === true)) }) });
    actions.push(...blockSpecificMenu(blockReadingActions(bodyRef.current?.querySelector<HTMLElement>(`[data-reading-row][data-position="${pos}"]`) ?? null, node.type.name)));
    return actions;
  };
  const toolbar = (
    <>
      {!props.showLineNumbers && <button type="button" title="块级操作" aria-label="块级操作" data-title-block-menu="true" aria-haspopup="menu" aria-expanded={blockMenu !== null} onMouseDown={event => event.preventDefault()} onClick={event => {
        const currentPosition = copyPosition.current ?? capture().position;
        const resolved = doc.resolve(Math.max(0, Math.min(currentPosition, doc.content.size)));
        const index = Math.min(doc.childCount - 1, resolved.index(0));
        let position = 0;
        for (let i = 0; i < index; i++) position += doc.child(i).nodeSize;
        const trigger = event.currentTarget;
        setBlockMenu(current => current?.trigger === trigger && current.doc === doc ? null : { position, number: index + 1, trigger, doc });
      }}><ToolbarIcon name="copy" /></button>}
      {props.documentViewToggle}
      <button
        ref={outlineTriggerRef}
        type="button"
        title="文档目录"
        aria-label="文档目录"
        aria-expanded={mobileDrawerViewport ? panel === "outline" : desktopPanels.pinned("outline") || preview === "outline"}
        data-document-panel-trigger="outline" data-pinned={desktopPanels.pinned("outline")}
        onPointerEnter={event => desktopPanels.enter("outline", event.pointerType)} onPointerLeave={desktopPanels.leave}
        onClick={() => mobileDrawerViewport ? openPanel(panel === "outline" ? null : "outline") : togglePinnedPanel("outline")}
      >
        <FocusModeIcon name="outline" />
      </button>
      <button
        ref={bookmarkTriggerRef}
        type="button"
        title={bookmarkPanelLabel}
        aria-label="文档书签"
        aria-expanded={mobileDrawerViewport ? panel === "bookmarks" : desktopPanels.pinned("bookmark") || preview === "bookmarks"}
        data-document-panel-trigger="bookmark" data-pinned={desktopPanels.pinned("bookmark")}
        onPointerEnter={event => desktopPanels.enter("bookmark", event.pointerType)} onPointerLeave={desktopPanels.leave}
        onClick={() => mobileDrawerViewport ? openPanel(panel === "bookmarks" ? null : "bookmarks") : togglePinnedPanel("bookmark")}
      >
        <FocusModeIcon name="bookmark" />
        {annotationTotal > 0 && <span className="focus-bookmark-count" aria-hidden="true">{annotationTotal > 99 ? "99+" : annotationTotal}</span>}
      </button>
      {!statusBar.navigationInStatus && <NavigationButtons />}
      {mobileDrawerViewport && <button
        type="button"
        className="document-focus-toggle"
        title={props.focusMode ? "退出专注模式" : "专注模式"}
        aria-label={props.focusMode ? "退出专注模式" : "专注模式"}
        onClick={() => props.onFocusModeChange?.(!props.focusMode)}
      >
        <ToolbarIcon name={props.focusMode ? "compress" : "expand"} />
      </button>}
    </>
  );
  const renderPanel = (kind: "outline" | "bookmarks" | "search") => (
          <section
            ref={preview === kind ? panelRef : undefined}
            className="vr-panel"
            data-document-kind={kind === "search" ? undefined : kind}
            style={kind !== "search" && desktopPanels.pinned(kind === "outline" ? "outline" : "bookmark") ? undefined : kind === "search" ? undefined : documentPanelStyle}
            data-document-preview={!mobileDrawerViewport && kind !== "search" && !desktopPanels.pinned(kind === "outline" ? "outline" : "bookmark") ? true : undefined}
            onPointerEnter={desktopPanels.cancel} onPointerLeave={desktopPanels.leave}
            aria-label={
              kind === "outline"
                ? "文档目录"
                : kind === "bookmarks"
                  ? "文档书签"
                  : "文内搜索"
            }
          >
            {!(kind !== "search" && !mobileDrawerViewport && desktopPanels.pinned(kind === "outline" ? "outline" : "bookmark")) && <button
              type="button"
              className="vr-panel-close"
              aria-label="关闭阅读面板"
              onClick={() => {
                if (kind === "search") { setQuery(""); setMatchIndex(0); }
                if (!mobileDrawerViewport && kind !== "search" && desktopPanels.pinned(kind === "outline" ? "outline" : "bookmark")) togglePinnedPanel(kind === "outline" ? "outline" : "bookmark");
                else { setPanel(null); dismissPreview(); }
              }}
            >
              ×
            </button>}
            {!mobileDrawerViewport && kind !== "search" && !desktopPanels.pinned(kind === "outline" ? "outline" : "bookmark") && <button type="button" onClick={() => togglePinnedPanel(kind === "outline" ? "outline" : "bookmark")}>固定{kind === "outline" ? "目录" : "书签"}</button>}
            {kind === "outline" && (
              <>
                {!mobileDrawerViewport && <h3><OutlinePanelTitle pinned={desktopPanels.pinned("outline")} onCollapse={() => togglePinnedPanel("outline")} /></h3>}
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      preserve();
                      setFolds(new Set(collapsedHeadingKeysForAll(sections)));
                    }}
                  >
                    全部折叠
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      preserve();
                      setFolds(new Set());
                    }}
                  >
                    全部展开
                  </button>
                </div>
                {outlineDisplayConfig?.showCounts && <span className="document-outline-count">{sections.length} 项</span>}
                {outlineDisplayConfig?.toolbar.map(command => <button key={command} type="button" aria-label="定位当前标题" title="定位当前标题" data-panel-display-command={command}
                  onClick={event => panelDisplays.run("document-outline", outlineDisplayConfig, command, { "outline.reveal-current": () => {
                    const position = capture().position;
                    const index = sections.reduce((last, section, index) => section.pos <= position ? index : last, 0);
                    event.currentTarget.closest("section")?.querySelectorAll(".vr-outline-row")[Math.max(0, index)]?.scrollIntoView({ block: "nearest" });
                  } })}><ToolbarIcon name="search" /></button>)}
                {sections.map((section, index) => (
                  <div
                    className="vr-outline-row"
                    data-panel-display={outlineDisplayConfig ? "plugin" : undefined}
                    key={section.key}
                    title={outlineDisplayConfig?.tooltip === "path" ? outlinePaths[index] : outlineLabel(section.text, 500)}
                    style={{ paddingLeft: (section.level - 1) * 12, ...(outlineDisplayConfig ? { fontFamily: outlineDisplayConfig.font === "mono" ? "var(--font-mono)" : outlineDisplayConfig.font === "sans" ? "var(--font)" : "inherit", fontSize: outlineDisplayConfig.fontSize, minHeight: mobileDrawerViewport ? Math.max(36, outlineDisplayConfig.rowHeight) : outlineDisplayConfig.rowHeight, color: outlineDisplayConfig.labelColor === "accent" ? "var(--accent)" : outlineDisplayConfig.labelColor === "secondary" ? "var(--text-secondary)" : "inherit" } : {}) }}
                  >
                    {sections[index + 1]?.level > section.level ? <button
                      type="button"
                      aria-label={`折叠切换 ${outlineLabel(section.text)}`}
                      aria-expanded={!folds.has(section.key)}
                      onClick={() => toggleHeading(section.pos)}
                    >
                      <EditorFoldIcon outline expanded={!folds.has(section.key)} />
                    </button> : <span className="vr-outline-fold-placeholder" aria-hidden="true" />}
                    <button
                      type="button"
                      data-drawer-swipe-item
                      onClick={() => {
                        jump(section.pos);
                        setPanel(null); dismissPreview();
                      }}
                    >
                      {outlineDisplayConfig?.showMetadata && <span className="document-outline-level">H{section.level} </span>}
                      {outlineLabel(section.text)}
                    </button>
                  </div>
                ))}
              </>
            )}
            {kind === "bookmarks" && (
              <>
                <h3><DocumentPanelTitle label={bookmarkPanelLabel} pinned={!mobileDrawerViewport && desktopPanels.pinned("bookmark")} onCollapse={() => togglePinnedPanel("bookmark")} />{bookmarkDisplayConfig?.showCounts !== false && <span className="document-bookmark-count">{annotationTotal} 项</span>}</h3>
                <PanelDisplayTools target="bookmarks" disabled={!annotationTotal} handlers={{ "bookmarks.reveal-current": () => { const position = capture().position; const nearest = annotationPanelItems.reduce<(typeof annotationPanelItems)[number] | undefined>((current, item) => !current || Math.abs(item.position - position) < Math.abs(current.position - position) ? item : current, undefined); revealPanelItem(bookmarkDisplayListRef.current, nearest?.id); } }} />
                {annotationTotal === 0 && <p>暂无书签</p>}
                <div className="document-bookmark-list" ref={bookmarkDisplayListRef} data-panel-display={bookmarkDisplayConfig ? "plugin" : undefined} style={panelDisplayStyle(bookmarkDisplayConfig) as React.CSSProperties}>
                {annotationPanelItems.map(item => <button
                  type="button"
                  className={`vr-bookmark ${item.kind === "annotation" ? "vr-reading-annotation" : ""}`}
                  data-bookmark-id={item.id}
                  title={item.kind === "bookmark" ? bookmarkTooltip(item.bookmark, bookmarkDisplayConfig) : item.annotation.note || item.annotation.exact}
                  data-drawer-swipe-item
                  key={`${item.kind}:${item.id}`}
                  onClick={() => {
                    jump(item.position);
                    if (item.kind === "annotation") {
                      window.requestAnimationFrame(() => {
                        const marker = bodyRef.current?.querySelector<HTMLElement>(`[data-reading-annotation="${CSS.escape(item.id)}"]`);
                        revealAnnotation(item.annotation, marker);
                      });
                    }
                    setPanel(null); dismissPreview();
                  }}
                >
                  <span className="reading-panel-kind" aria-hidden="true">{item.kind === "annotation" ? "▰" : "◆"}</span>
                  {bookmarkDisplayConfig?.showMetadata && <span className="document-bookmark-index">{doc.resolve(Math.min(doc.content.size, Math.max(0, item.position))).index(0) + 1}</span>}
                  {item.text.length > 140 ? `${item.text.slice(0, 140)}…` : item.text}
                </button>)}
                </div>
                <button type="button" onClick={fallback}>
                  管理书签（完整渲染）
                </button>
              </>
            )}
            {kind === "search" && (
              <>
                <input
                  autoFocus
                  aria-label="搜索正文"
                  value={query}
                  onChange={(event) => {
                    const value = event.target.value;
                    setQuery(value);
                    setMatchIndex(0);
                    const match = findSearchMatches(doc, value)[0];
                    if (match) jump(match.from, 0, match);
                  }}
                />
                <span>
                  {matches.length
                    ? `${matchIndex + 1}/${matches.length}`
                    : "无匹配"}
                </span>
                {[-1, 1].map((direction) => (
                  <button
                    type="button"
                    key={direction}
                    disabled={!matches.length}
                    onClick={() => {
                      const next =
                        (matchIndex + direction + matches.length) %
                        matches.length;
                      setMatchIndex(next);
                      jump(matches[next].from, 0, matches[next]);
                    }}
                  >
                    {direction < 0 ? "上一个" : "下一个"}
                  </button>
                ))}
              </>
            )}
          </section>
  );
  useNativeMenuActions({
    "document.outline": { run: () => desktopPanels.toggle("outline"), checked: desktopPanels.pinned("outline") || preview === "outline", enabled: sections.length > 0 },
    "document.bookmarks": { run: () => desktopPanels.toggle("bookmark"), checked: desktopPanels.pinned("bookmark") || preview === "bookmarks" },
    "document.find": { run: () => openPanel("search") },
  }, active);
  const tocContext = useMemo(() => ({ items: extractDocumentOutline(doc), navigate: navigateHeading }), [doc, navigateHeading]);
  return (
    <DocumentOutlineContext.Provider value={tocContext}>
    {blockMenu && active && doc === blockMenu.doc && <BlockActionMenu placement={blockMenu.trigger.hasAttribute("data-title-block-menu") ? "below" : "side"} key={blockMenu.position} title={`第 ${blockMenu.number} 块`} blockNumber={blockMenu.number} blockType={doc.nodeAt(blockMenu.position)?.type.name} trigger={blockMenu.trigger} actions={blockMenuActions()} onClose={closeBlockMenu} />}
    <div
      className={`note-editor note-editor-readonly vr-note ${desktopPanelClass(desktopPanels, sections.length > 0)} ${props.cjkLatinSpacing ? "editor-auto-cjk-spacing" : ""} ${props.focusMode ? "focus-mode" : ""} ${props.showLineNumbers ? "show-line-numbers" : ""} ${props.highlightActiveLine ? "" : "no-active-line"}`}
      data-virtual-reader="true"
      onPointerDownCapture={event => {
        if (event.button === 0) lastAnnotationSelection.current = null;
      }}
      onClick={event => {
        const trigger = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-workspace-position]") : null;
        if (!trigger) return;
        queueBlockWorkspace(noteId, Number(trigger.dataset.workspacePosition));
        fallback();
      }}
      style={
        {
          ...desktopPanelStyle(desktopPanels),
          "--editor-font-size": `${props.editorFontSize}px`,
          "--editor-gutter-width": `${editorGutterWidth(doc.childCount, props.showLineNumbers, true)}px`,
          "--editor-gutter-text-gap": props.showLineNumbers ? "4px" : "0px",
        } as React.CSSProperties
      }
    >
      {props.focusMode && !props.unifiedTitleBar ? (
        <FocusModeBar target={props.focusToolbarTarget} onOpenProperties={props.onOpenProperties} title={props.title || "无标题"} leading={
          <button type="button" className="focus-readonly-toggle" data-document-readonly="true" aria-label="点击设为可编辑"
            title="点击设为可编辑" aria-pressed="true" disabled={!props.onReadonlyChange}
            onClick={() => {
              handoffReadingAnchor(noteId, capture());
              void props.onReadonlyChange?.(false);
            }}><ToolbarIcon name="lock" /></button>
        }>{toolbar}</FocusModeBar>
      ) : (
        <div className="vr-title">
          {props.titleSecurityAction}
          <button
            type="button"
            data-document-readonly="true"
            aria-pressed="true"
            aria-label="设为可编辑"
            disabled={!props.onReadonlyChange}
            onClick={() => {
              handoffReadingAnchor(noteId, capture());
              void props.onReadonlyChange?.(false);
            }}
          >
            <ToolbarIcon name="lock" />
          </button>
          {props.mobileTitleBar ? <DocumentTitlePreview key={noteId} title={props.title || "无标题"} className={props.saveIssue ? `note-title-save-${props.saveIssue}` : ""} onOpenProperties={props.onOpenProperties} /> : props.onOpenProperties ? <button type="button" className={`vr-properties-title${props.saveIssue ? ` note-title-save-${props.saveIssue}` : ""}`} aria-label="文档属性" onClick={props.onOpenProperties}>{props.title || "无标题"}</button> : <strong className={props.saveIssue ? `note-title-save-${props.saveIssue}` : undefined}>{props.title || "无标题"}</strong>}
          {props.saveIssue && <button type="button" className="workspace-error-indicator" onClick={props.onOpenSaveIssue} aria-label="查看保存错误详情"><ToolbarIcon name="warning" /></button>}
          {toolbar}
        </div>
      )}
      <div className="vr-actions" aria-label="局部阅读实验工具栏">
        <span>局部阅读 · 实验</span>
        <button type="button" onClick={() => jump(0)}>
          顶端
        </button>
        <button
          type="button"
          onClick={() => jump(blocks[blocks.length - 1]?.pos ?? 0)}
        >
          末尾
        </button>
        <button type="button" onClick={() => openPanel("search")}>
          搜索
        </button>
        <button
          type="button"
          onClick={() =>
            void copyToClipboard(
              clipboardSliceToPlainText(new Slice(doc.content, 0, 0), doc),
            )
          }
        >
          复制全文
        </button>
        <button type="button" onClick={fallback}>
          完整渲染
        </button>
      </div>
      {notice && (notice.startsWith("已复制") || notice.startsWith("复制块失败") ?
        <CopyBlockNotice message={notice} onClose={() => setNotice("")} /> :
        <div className="vr-notice" role="status">
          {notice}
          <button type="button" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      {blockJumpValue !== null && <form className="editor-line-jump" role="dialog" aria-label="跳转块" onSubmit={event => { event.preventDefault(); submitBlockJump(); }}>
        <label htmlFor={`block-jump-${noteId}`}>块号</label>
        <input ref={blockJumpInput} id={`block-jump-${noteId}`} aria-label="跳转到块号" inputMode="numeric" value={blockJumpValue} aria-invalid={Boolean(blockJumpError)} onChange={event => { setBlockJumpValue(event.target.value); setBlockJumpError(""); }} />
        <span role="status" className={blockJumpError ? "editor-line-jump-error" : "editor-line-jump-range"}>{blockJumpError || `/ ${doc.childCount}`}</span>
        <button type="submit" aria-label="跳转" title="跳转">↵</button>
        <button type="button" aria-label="关闭跳转" title="关闭跳转" onClick={closeBlockJump}>×</button>
      </form>}
      <DocumentPanelDrawer
        enabled={mobileDrawerViewport}
        presentation={presentation}
        panel={
          panel === "outline"
            ? "outline"
            : panel === "bookmarks"
              ? "bookmark"
              : null
        }
        hasOutline={sections.length > 0}
        onSelect={(next) =>
          setPanel(next === "outline" ? "outline" : "bookmarks")
        }
        onClose={() => setPanel(null)}
      >
        {mobileDrawerViewport && panel && renderPanel(panel)}
      </DocumentPanelDrawer>
      {!mobileDrawerViewport && <>
        <DesktopDocumentPanels controller={desktopPanels} bookmarkEmpty={annotationTotal === 0}
          outline={(desktopPanels.pinned("outline") || preview === "outline") && sections.length > 0 ? renderPanel("outline") : null}
          bookmark={(desktopPanels.pinned("bookmark") || preview === "bookmarks") ? renderPanel("bookmarks") : null} />
        {panel === "search" && renderPanel("search")}
      </>}
      <div className="note-editor-scroll vr-scroll" ref={rootRef}>
        <div
          className="editor-content vr-body"
          ref={bodyRef}
          tabIndex={0}
          role="document"
          aria-label="只读正文"
          onPointerOver={documentHover.onPointerOver}
          onPointerOut={documentHover.onPointerOut}
          onPointerOverCapture={handleAnnotationPointerOver}
          onPointerOutCapture={handleAnnotationPointerOut}
          onContextMenu={event => {
            if (!READING_ANNOTATIONS_ENABLED || !props.readonly) return;
            const root = bodyRef.current;
            const range = (root && selectedReadonlyRange(root)) ?? lastAnnotationSelection.current;
            if (!range) return;
            event.preventDefault();
            event.stopPropagation();
            setAnnotationContext({ x: event.clientX, y: event.clientY, ...range });
          }}
          onPointerDownCapture={event => {
            if (event.button === 0) lastAnnotationSelection.current = null;
          }}
          onPointerUpCapture={() => {
            const root = bodyRef.current;
            const range = root && selectedReadonlyRange(root);
            if (range) lastAnnotationSelection.current = range;
          }}
          onKeyUpCapture={event => {
            if (!props.readonly || !(event.shiftKey || event.key.startsWith("Arrow"))) return;
            const root = bodyRef.current;
            const range = root && selectedReadonlyRange(root);
            if (range) lastAnnotationSelection.current = range;
          }}
          onClick={event => {
            const marker = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-reading-annotation]") : null;
            const item = annotations.find(annotation => annotation.id === marker?.dataset.readingAnnotation);
            if (item) revealAnnotation(item, marker);
          }}
          onFocusCapture={documentHover.onFocusCapture}
          onBlurCapture={documentHover.onBlurCapture}
          onScrollCapture={documentHover.onScrollCapture}
          onClickCapture={(event) => {
            const heading = headingLinkTarget(event.target, extractDocumentOutline(doc), doc);
            if (heading) {
              event.preventDefault();
              event.stopPropagation();
              navigateHeading(heading);
              return;
            }
            const id = footnoteLinkTarget(event.target);
            if (!id) return;
            event.preventDefault();
            event.stopPropagation();
            const body = bodyRef.current;
            if (body && scrollToFootnote(body, id)) return;
            const position = footnoteBlockPosition(doc, id);
            if (position === null) return;
            pendingFootnote.current = id;
            jump(position);
          }}
          onDoubleClick={(event) => {
            if (
              !props.focusMode ||
              !props.readonlyHeadingFoldInFocusMode ||
              !(event.target instanceof Element) ||
              event.target.closest("button, a")
            )
              return;
            const heading = event.target.closest("h1,h2,h3,h4,h5,h6");
            const row = heading?.closest<HTMLElement>("[data-reading-row]");
            if (row) {
              event.preventDefault();
              event.stopPropagation();
              window.getSelection()?.removeAllRanges();
              if (Date.now() - (tap.current?.time ?? 0) > 500) {
                lastDoubleFold.current = { time: Date.now(), number: Number(row.dataset.blockNumber) };
                setCurrentNumber(Number(row.dataset.blockNumber));
                toggleHeading(Number(row.dataset.position));
              }
            }
          }}
          onMouseDownCapture={(event) => {
            const folded = lastDoubleFold.current;
            if (event.button === 0 && event.detail >= 3 && folded && Date.now() - folded.time < 650) {
              event.preventDefault();
              event.stopPropagation();
              pointer.current = null;
              tap.current = null;
              setCurrentNumber(folded.number);
            }
          }}
          onPointerDown={(event) => {
            const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-reading-row]") : null;
            if (row) {
              copyPosition.current = Number(row.dataset.position);
              setCurrentNumber(Number(row.dataset.blockNumber));
            }
            pointer.current = {
              x: event.clientX,
              y: event.clientY,
              moved: false,
            };
          }}
          onPointerMove={(event) => {
            if (
              pointer.current &&
              Math.hypot(
                event.clientX - pointer.current.x,
                event.clientY - pointer.current.y,
              ) > 12
            )
              pointer.current.moved = true;
          }}
          onPointerCancel={() => {
            pointer.current = null;
            tap.current = null;
          }}
          onPointerUp={(event) => {
            const gesture = pointer.current;
            pointer.current = null;
            if (
              event.pointerType !== "touch" ||
              !gesture ||
              gesture.moved ||
              !props.focusMode ||
              !props.readonlyHeadingFoldInFocusMode ||
              !(event.target instanceof Element) ||
              event.target.closest("button,a")
            )
              return;
            const row = event.target
              .closest("h1,h2,h3,h4,h5,h6")
              ?.closest<HTMLElement>("[data-reading-row]");
            if (!row) return;
            const pos = Number(row.dataset.position),
              time = Date.now(),
              previous = tap.current;
            if (
              previous &&
              previous.pos === pos &&
              time - previous.time < 350 &&
              Math.hypot(
                previous.x - event.clientX,
                previous.y - event.clientY,
              ) < 24
            ) {
              event.preventDefault();
              window.getSelection()?.removeAllRanges();
              toggleHeading(pos);
            }
            tap.current = { pos, time, x: event.clientX, y: event.clientY };
          }}
        >
          <div aria-hidden="true" style={{ height: layout.offsets[start] }} />
          {blocks.slice(start, end).map((block, visibleIndex) => {
            const section = sectionByPos.get(block.pos);
            return (
              <div
                className="vr-row"
                key={block.pos}
                data-reading-row
                data-block-type={block.node.type.name}
                data-next-heading={blocks[start + visibleIndex + 1]?.node.type.name === "heading" || undefined}
                data-next-heading-level={blocks[start + visibleIndex + 1]?.node.type.name === "heading" ? blocks[start + visibleIndex + 1].node.attrs.level : undefined}
                data-position={block.pos}
                data-block-number={block.number}
              >
                <ReadingBlockGutter node={block.node} number={block.number}
                  displayNumber={relativeBlockNumbers ? relativeNumber(block.number, currentNumber, visibleNumbers) : block.number}
                  active={block.number === currentNumber} showNumbers={props.showLineNumbers} relative={relativeBlockNumbers} alignment={relativeBlockNumberAlignment}
                  section={section} folded={!!section && folds.has(section.key)} onToggleFold={() => toggleHeading(block.pos)}
                  onOpen={trigger => setBlockMenu(current => current?.position === block.pos && current.doc === doc ? null : { position: block.pos, number: block.number, trigger, doc })} />
                <div className={`ProseMirror vr-block${block.number === currentNumber ? " ProseMirror-activeline" : ""}`} contentEditable={false}>
                  {decorateFlowBlock(renderReadonlyBlock(
                    block.node,
                    block.pos,
                    states,
                    updateBlock,
                    activeMatch,
                    props.defaultCodeBlockWrap,
                    followupBlocks.has(block.pos),
                    true,
                    "",
                    annotations,
                  ), flowAttributes.get(block.pos))}
                </div>
              </div>
            );
          })}
          <div
            aria-hidden="true"
            style={{
              height:
                Math.max(0, layout.total - layout.offsets[end]) +
                Math.max(100, viewport.height - 80),
            }}
          />
        </div>
      </div>
      {annotationContext && <div className="reading-annotation-context" role="menu" aria-label="选区标注操作" style={{ left: annotationContext.x, top: annotationContext.y }}
        onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }} onClick={event => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => { lastAnnotationSelection.current = null; void addAnnotation(annotationContext); }}>添加阅读高亮</button>
        <button type="button" role="menuitem" onClick={() => setAnnotationContext(null)}>取消</button>
      </div>}
      {annotationPopover && (() => {
        const annotation = annotations.find(item => item.id === annotationPopover.id);
        if (!annotation) return null;
        return <ReadingAnnotationBubble annotation={annotation} left={annotationPopover.left} top={annotationPopover.top}
          onPointerEnter={() => { if (annotationLeaveTimer.current !== null) window.clearTimeout(annotationLeaveTimer.current); }}
          onPointerLeave={() => { if (annotationLeaveTimer.current !== null) window.clearTimeout(annotationLeaveTimer.current); annotationLeaveTimer.current = window.setTimeout(() => setAnnotationPopover(null), 180); }}
          onSave={note => { void updateAnnotation(annotation.id, note); }}
          onClear={() => { void updateAnnotation(annotation.id, ""); }}
          onDelete={() => { void removeAnnotation(annotation.id); }} />;
      })()}
      {documentHover.preview}
      <EditorStatusBar onCreateDocument={props.onCreateDocument} enabled={props.showStatusBar} focusMode={props.focusMode} saveStatus={props.saveStatus ?? "clean"} blockPosition={(statusBar.display ? statusBar.items.includes("block") : props.showStatusBlockNumber) ? { current: Math.min(Math.max(1, currentNumber), doc.childCount), total: doc.childCount } : undefined} />

    </div></DocumentOutlineContext.Provider>
  );
}

export function decorateFlowBlock(block: React.ReactNode, attrs?: Record<string, string>): React.ReactNode {
  if (!attrs || !React.isValidElement<{ className?: string }>(block)) return block;
  const { class: flowClass, ...data } = attrs;
  return React.cloneElement(block, { ...data, className: `${block.props.className ?? ""} ${flowClass}` });
}
