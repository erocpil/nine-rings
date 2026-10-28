import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
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
import { collapsedHeadingKeysForAll, extractHeadingSections, headingSectionAtPosition, sessionHeadingFoldStore } from "../lib/heading-fold";
import { editorGutterWidth } from "../lib/editor-gutter";
import { firstLineTextCenter } from "../lib/block-gutter-geometry";
import { relativeNumber } from "../lib/relative-numbering";
import { useRelativeNumbering } from "../hooks/useRelativeNumbering";
import { useNumberingDisplay } from "../hooks/useNumberingDisplay";
import { useMobileViewport } from "../hooks/useEdgeDrawer";
import { CopyBlockNotice } from "./CopyBlockNotice";
import { useBlockDisplayPreferences } from "../hooks/useBlockDisplayPreferences";
import { findSearchMatches } from "../extensions/SearchHighlights";
import { type SearchOptions, searchPatternError } from "../lib/search-matching";
import { useSearchRegex } from "../hooks/useSearchRegex";
import { isDocumentFindKeyEvent, isEditorLineJumpKeyEvent } from "../lib/shortcuts";
import { useNativeMenuActions } from "../hooks/useNativeMenuActions";
import { ToolbarIcon } from "./ToolbarIcon";
import { EditorStatusBar } from "./EditorStatusBar";
import { readReadingState, patchReadingState } from "../lib/reading-state";
import { markdownContentFingerprint } from "../lib/external-markdown-source";
import { centerSearchMatch } from "../lib/search-scroll";

const ReadonlyBlockWorkspace = lazy(() => import("./ReadonlyBlockWorkspace").then(module => ({ default: module.ReadonlyBlockWorkspace })));

export const MARKDOWN_READING_NAVIGATE_EVENT = "nine-rings:markdown-reading-navigate";

/** View state belongs to the file session; rendering never rewrites the raw source. */
export interface MarkdownReadingSession {
  readonly identity: string;
  readonly source: string;
  scrollTop: number;
  states: Map<number, ReadingBlockState>;
  foldedHeadings: Set<string>;
  activePos?: number;
  hydrated?: boolean;
}

/** Shared read-only Markdown projection, independent of database document identity. */
export function MarkdownReadingView({ doc, source, session, fontSize, highlightActiveLine, showLineNumbers, doubleClickFold = false, className = "", onClick, onActivePosition, defaultCodeBlockWrap = true, cjkLatinSpacing = true, active = true, toolsVisible = true, showStatusBar = true, focusMode = false, saveStatus, bookmarks = [], onToggleBookmark }: {
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
  defaultCodeBlockWrap?: boolean;
  cjkLatinSpacing?: boolean;
  active?: boolean;
  toolsVisible?: boolean;
  showStatusBar?: boolean;
  focusMode?: boolean;
  saveStatus?: "clean" | "dirty" | "saving" | "saved" | "error";
  bookmarks?: readonly number[];
  onToggleBookmark?: (position: number) => void;
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
  const [workspace, setWorkspace] = useState<{ pos: number; trigger: HTMLElement } | null>(null);
  const [toolPanel, setToolPanel] = useState<"find" | "jump" | null>(null);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchOptions>({});
  const [matchIndex, setMatchIndex] = useState(0);
  const [jumpValue, setJumpValue] = useState("");
  const [jumpError, setJumpError] = useState("");
  const [foldMenu, setFoldMenu] = useState<HTMLButtonElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useBlockDisplayPreferences();
  const regex = useSearchRegex(options.regex === true);
  const searches = useMemo(() => {
    const error = options.regex ? regex.error || (!regex.ready ? "正在加载 Perl 正则引擎…" : searchPatternError(query, options)) : "";
    if (error) return { matches: [], error };
    try { return { matches: findSearchMatches(doc, query, false, options.caseSensitive === true, options), error: "" }; }
    catch (cause) { return { matches: [], error: String(cause) }; }
  }, [doc, query, options, regex.ready, regex.error]);
  const activeMatch = searches.matches[matchIndex % (searches.matches.length || 1)];
  const readingKey = `local-file:${session.identity}`;
  const readingVersion = useMemo(() => markdownContentFingerprint(source), [source]);
  useEffect(() => {
    const save = () => patchReadingState(readingKey, {
      rendered: { scrollTop: session.scrollTop },
      blocks: { revision: readingVersion, entries: [...session.states] },
    });
    window.addEventListener("pagehide", save);
    return () => { window.removeEventListener("pagehide", save); save(); };
  }, [session, readingKey, readingVersion]);
  useMemo(() => {
    if (!session.hydrated) {
      const saved = readReadingState(readingKey);
      if (saved.blocks?.revision === readingVersion) {
        for (const [at, state] of saved.blocks.entries) session.states.set(at, state);
        session.scrollTop = saved.rendered?.scrollTop ?? session.scrollTop;
      }
      session.hydrated = true;
    }
    return session;
  }, [session, readingKey, readingVersion]);
  const [menu, setMenu] = useState<(NotesMenuTarget & { selectedText: string }) | null>(null);
  const numbering = useNumberingDisplay();
  const showNumbers = numbering.blocks?.visible ?? showLineNumbers;
  const { relativeBlockNumbers, relativeBlockNumberAlignment } = useRelativeNumbering();
  const compact = useMobileViewport();
  const documentHover = useDocumentHoverPreview(() => doc);
  useEffect(() => {
    if (!active) { setWorkspace(null); setToolPanel(null); setBlockMenu(null); setQuery(""); }
  }, [active]);
  useEffect(() => { setWorkspace(null); setBlockMenu(null); }, [session]);
  useLayoutEffect(() => { input.current?.focus({ preventScroll: true }); }, [toolPanel]);
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
    let revealedBlock = false;
    doc.nodesBetween(Math.min(item.pos, doc.content.size), Math.min(item.pos + 1, doc.content.size), (node, pos) => {
      if (["codeBlock", "blockquote", "htmlDetails"].includes(node.type.name)) {
        const before = session.states.get(pos);
        if ((before?.collapsed ?? (node.type.name === "htmlDetails" ? node.attrs.open !== true : node.attrs.collapsed === true)) ||
          node.type.name === "codeBlock" && ["mermaid", "flow"].includes(node.attrs.language) && before?.diagram !== false) {
          session.states.set(pos, { ...before, collapsed: false, ...(node.type.name === "codeBlock" ? { diagram: false } : {}) });
          revealedBlock = true;
        }
      }
    });
    const next = new Set(folds);
    for (const section of sections) if (section.headingEnd <= item.pos && item.pos < section.end) next.delete(section.key);
    if (next.size !== folds.size || revealedBlock) {
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
  const showTool = (panel: "find" | "jump") => {
    setFoldMenu(null);
    setToolPanel(previous => previous === panel ? null : panel);
    if (panel === "jump") { setJumpValue(String(current?.number ?? 1)); setJumpError(""); }
  };
  useNativeMenuActions({ "document.find": { run: () => showTool("find") }, "document.jump": { run: () => showTool("jump") } }, active);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open], [aria-modal="true"], [role="menu"]')) return;
      if (isDocumentFindKeyEvent(event) || isEditorLineJumpKeyEvent(event)) {
        event.preventDefault(); event.stopImmediatePropagation();
        showTool(isDocumentFindKeyEvent(event) ? "find" : "jump");
      } else if (event.key === "Escape" && toolPanel) {
        event.preventDefault(); event.stopImmediatePropagation();
        setToolPanel(null); setQuery(""); content.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  });
  const previousSearch = useRef("");
  const pendingSearch = useRef(false);
  useEffect(() => {
    const key = activeMatch ? `${readingVersion}:${query}:${JSON.stringify(options)}:${activeMatch.from}:${activeMatch.to}` : "";
    if (key !== previousSearch.current) {
      previousSearch.current = key;
      if (activeMatch) { pendingSearch.current = true; navigate({ pos: activeMatch.from }); }
    }
  });
  const navigateSearch = (direction: number) => {
    if (!searches.matches.length) return;
    setMatchIndex(index => (index + direction + searches.matches.length) % searches.matches.length);
  };
  const submitJump = () => {
    const number = Number(jumpValue);
    if (!Number.isInteger(number) || number < 1 || number > doc.childCount) { setJumpError(`请输入 1–${doc.childCount} 的块号`); return; }
    let pos = 0;
    for (let index = 0; index < number - 1; index++) pos += doc.child(index).nodeSize;
    navigate({ pos }); setToolPanel(null); content.current?.focus({ preventScroll: true });
  };
  const foldAll = (expand: boolean) => {
    const row = current && rowAt(current.pos);
    const heading = current && headingSectionAtPosition(sections, current.pos);
    const anchor = heading && rowAt(heading.pos) || row;
    if (anchor) pendingAnchor.current = { pos: Number(anchor.dataset.readingPosition), top: anchor.getBoundingClientRect().top };
    session.foldedHeadings = new Set(expand ? [] : collapsedHeadingKeysForAll(sections));
    sessionHeadingFoldStore.save(readingKey, { version: 1, collapsedKeys: [...session.foldedHeadings] });
    redraw(value => value + 1);
  };
  const foldToLevel = (level: number) => {
    session.foldedHeadings = new Set(sections.filter(section => section.level >= level && section.end > section.headingEnd).map(section => section.key));
    sessionHeadingFoldStore.save(readingKey, { version: 1, collapsedKeys: [...session.foldedHeadings] });
    redraw(value => value + 1);
  };
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
    if (pendingSearch.current) {
      const mark = body.current?.querySelector<HTMLElement>("mark.search-match-active");
      if (mark) {
        let container = mark.parentElement;
        while (container && container !== root) {
          if (container.scrollHeight > container.clientHeight && /auto|scroll/.test(getComputedStyle(container).overflowY)) {
            centerSearchMatch(container, mark.getBoundingClientRect());
          }
          container = container.parentElement;
        }
        centerSearchMatch(root, mark.getBoundingClientRect());
        pendingSearch.current = false;
      }
    }
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
    patchReadingState(readingKey, { blocks: { revision: readingVersion, entries: [...session.states] } });
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
    if (onToggleBookmark) actions.push({ label: bookmarks.some(pos => blockMenu.pos <= pos && pos < blockMenu.pos + node.nodeSize) ? "取消块书签" : "添加块书签", run: () => onToggleBookmark(blockMenu.pos) });
    actions.push({ label: "打开块模式", run: () => setWorkspace({ pos: blockMenu.pos, trigger: blockMenu.trigger }) });
    if (section && section.end > section.headingEnd) actions.push({ label: "折叠 / 展开本节", run: () => toggleHeading(blockMenu.pos) });
    else if (["codeBlock", "blockquote", "htmlDetails"].includes(node.type.name)) actions.push({ label: "折叠 / 展开此块", run: () => updateBlock(blockMenu.pos, {
      collapsed: !(session.states.get(blockMenu.pos)?.collapsed ?? (node.type.name === "htmlDetails" ? node.attrs.open !== true : node.attrs.collapsed === true)),
    }) });
    actions.push(...blockSpecificMenu(blockReadingActions(rowAt(blockMenu.pos), node.type.name)));
    return actions;
  };
  return <DocumentOutlineContext.Provider value={{ items, navigate }}><div className="markdown-reading-surface">
    {toolsVisible && <div className="editor-menu markdown-reading-tools" role="toolbar" aria-label="本地 Markdown 阅读工具">
      <button type="button" className="menu-btn" aria-label="文档查找" title="文档查找（⌘F / Ctrl+F）" aria-pressed={toolPanel === "find"} onClick={() => showTool("find")}><ToolbarIcon name="search" /></button>
      <button type="button" className="menu-btn" aria-label="跳转块" title="跳转块（⌘G / Ctrl+G）" aria-pressed={toolPanel === "jump"} onClick={() => showTool("jump")}><ToolbarIcon name="jumpLine" /></button>
      <button type="button" className="menu-btn" aria-label="折叠全部标题" title="折叠全部标题" disabled={!sections.length} aria-pressed={folds.size > 0} onClick={() => foldAll(false)}><ToolbarIcon name="minus" /></button>
      <button type="button" className="menu-btn" aria-label="展开全部标题" title="展开全部标题" disabled={!sections.length} aria-pressed={folds.size === 0} onClick={() => foldAll(true)}><ToolbarIcon name="plus" /></button>
      {new Set(sections.map(section => section.level)).size > 1 && <button type="button" className="menu-btn toolbar-split-caret" aria-label="选择标题折叠级别" title="选择标题折叠级别" aria-haspopup="menu" onClick={event => setFoldMenu(previous => previous ? null : event.currentTarget)}>▾</button>}
    </div>}
    {toolPanel === "find" && <div className="editor-find-bar" role="search" aria-label="本地 Markdown 查找">
      <div className="editor-find-header"><span>文档查找</span><button type="button" aria-label="关闭查找" className="editor-find-close" onClick={() => { setToolPanel(null); setQuery(""); }}>×</button></div>
      <div className="editor-find-row"><input ref={input} value={query} aria-label="在当前文档中查找" placeholder="在当前文档中查找" onChange={event => { setQuery(event.target.value); setMatchIndex(0); }} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); navigateSearch(event.shiftKey ? -1 : 1); } }} />
        <span className="editor-find-count" role="status">{searches.matches.length ? `${matchIndex % searches.matches.length + 1}/${searches.matches.length}` : "0/0"}</span>
        <button type="button" disabled={!searches.matches.length} aria-label="上一处匹配" onClick={() => navigateSearch(-1)}>↑</button><button type="button" disabled={!searches.matches.length} aria-label="下一处匹配" onClick={() => navigateSearch(1)}>↓</button>
      </div><div className="editor-find-options"><span className="search-scope-label">当前文档</span>{(["caseSensitive", "wholeWord", "regex"] as const).map((key, index) => <label key={key}><input type="checkbox" checked={options[key] === true} onChange={event => { setOptions(previous => ({ ...previous, [key]: event.target.checked })); setMatchIndex(0); }} />{["区分大小写", "全词匹配", "正则表达式（Perl）"][index]}</label>)}</div>
      {searches.error && <p role="alert" className="search-pattern-error">{searches.error}</p>}
    </div>}
    {toolPanel === "jump" && <form className="editor-line-jump" role="dialog" aria-label="跳转块" onSubmit={event => { event.preventDefault(); submitJump(); }}>
      <label>块号<input ref={input} aria-label="跳转到块号" inputMode="numeric" value={jumpValue} onChange={event => { setJumpValue(event.target.value); setJumpError(""); }} /></label>
      <span role="status" className={jumpError ? "editor-line-jump-error" : "editor-line-jump-range"}>{jumpError || `/ ${doc.childCount}`}</span>
      <button type="submit">跳转</button><button type="button" className="btn-icon" aria-label="关闭跳转块" onClick={() => setToolPanel(null)}>×</button>
    </form>}
    <div ref={content} className={`editor-content note-editor-scroll vr-note markdown-reading-view ${className}${showNumbers ? " show-line-numbers" : ""}${highlightActiveLine ? "" : " no-active-line"}`}
      aria-label="Markdown 渲染" tabIndex={0} style={{ fontSize, "--editor-gutter-width": `${editorGutterWidth(doc.childCount, showNumbers, compact)}px`, "--editor-gutter-text-gap": showNumbers ? "4px" : "0px" } as CSSProperties}
      onScroll={event => { session.scrollTop = event.currentTarget.scrollTop; }}
      onPointerOver={documentHover.onPointerOver} onPointerOut={documentHover.onPointerOut}
      onFocusCapture={documentHover.onFocusCapture} onBlurCapture={documentHover.onBlurCapture}
      onScrollCapture={documentHover.onScrollCapture}
      onClick={event => {
        const opener = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-workspace-position]") : null;
        if (opener) { event.preventDefault(); setWorkspace({ pos: Number(opener.dataset.workspacePosition), trigger: opener }); return; }
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
            {renderReadonlyBlock(node, pos, session.states, updateBlock, activeMatch, defaultCodeBlockWrap, followups.has(pos), cjkLatinSpacing)}
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
    <EditorStatusBar enabled={showStatusBar} focusMode={focusMode} saveStatus={saveStatus} blockPosition={{ current: current?.number ?? 1, total: doc.childCount }} characters={doc.textContent.length} navigation={null} />
    {foldMenu && <BlockActionMenu title="标题折叠级别" trigger={foldMenu} actions={[...new Set(sections.map(section => section.level))].sort().map(level => ({ label: `显示至 H${level}`, run: () => foldToLevel(level) }))} onClose={() => setFoldMenu(null)} />}
    {workspace && <Suspense fallback={<div role="status">正在打开块模式…</div>}><ReadonlyBlockWorkspace key={workspace.pos} doc={doc} position={workspace.pos} trigger={workspace.trigger} highlightActiveLine={highlightActiveLine} onClose={() => setWorkspace(null)} onNavigate={pos => setWorkspace(previous => previous ? { pos, trigger: rowAt(pos)?.querySelector<HTMLElement>("[data-workspace-position]") ?? previous.trigger } : null)} /></Suspense>}
  </div></DocumentOutlineContext.Provider>;
}
