import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Extension } from "@tiptap/core";
import { useEditor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { documentRenderingExtensions, readonlyDocumentGuard } from "../extensions/document-rendering";
import { ActiveLinePlugin, activeLinePluginKey } from "../extensions/EditorHighlights";
import { HeadingFold, headingFoldPluginKey, expandHeadingFoldsAt } from "../extensions/HeadingFold";
import { ReadingBlockSession } from "../extensions/ReadingBlockSession";
import { SearchHighlights, findSearchMatches, setSearchHighlights } from "../extensions/SearchHighlights";
import { CjkLatinSpacing, setCjkLatinSpacing, supportsNativeCjkLatinSpacing } from "../extensions/CjkLatinSpacing";
import { setCodeBlockDefaultWrap } from "../extensions/CodeBlockLineNumbers";
import { headingFoldAnchors } from "../lib/heading-fold-anchors";
import { collapsedHeadingKeysForAll, extractHeadingSections, headingSectionAtPosition } from "../lib/heading-fold";
import type { ReadingBlockState } from "../lib/reading-block-session";
import { editorGutterWidth } from "../lib/editor-gutter";
import { extractDocumentOutline } from "../lib/document-outline";
import { headingLinkTarget } from "../lib/heading-links";
import { footnoteLinkTarget, scrollToFootnote } from "../lib/footnote-navigation";
import { centerSearchMatch } from "../lib/search-scroll";
import { restoreDocumentViewport, EDITOR_NAVIGATION_EVENT } from "../lib/document-reading-restoration";
import { type SearchOptions, searchPatternError } from "../lib/search-matching";
import { isDocumentFindKeyEvent, isEditorLineJumpKeyEvent } from "../lib/shortcuts";
import { copyToClipboard } from "../lib/clipboard";
import { clipboardSliceToPlainText } from "../lib/clipboard-plain-text";
import { copyDocumentBlock } from "../lib/block-clipboard";
import { useSearchRegex } from "../hooks/useSearchRegex";
import { useNativeMenuActions } from "../hooks/useNativeMenuActions";
import { useMobileViewport } from "../hooks/useEdgeDrawer";
import { useNumberingDisplay } from "../hooks/useNumberingDisplay";
import { useDocumentHoverPreview } from "./FootnoteHoverPreview";
import { DocumentOutlineContext } from "./TableOfContentsBlock";
import { DocumentRenderBody } from "./DocumentRenderBody";
import { EditorBlockGutter } from "./EditorBlockGutter";
import { BlockWorkspaceHost } from "./BlockWorkspace";
import { BlockActionMenu, type BlockMenuAction } from "./BlockActionMenu";
import { blockReadingActions, blockSpecificMenu } from "./block-specific-actions";
import { openBlockWorkspace } from "../lib/block-workspace";
import { ToolbarIcon } from "./ToolbarIcon";
import { EditorStatusBar } from "./EditorStatusBar";
import { NotesContextMenu, type NotesMenuTarget } from "./NotesContextMenu";
import { CopyBlockNotice } from "./CopyBlockNotice";

export const DOCUMENT_READING_NAVIGATE_EVENT = "nine-rings:document-reading-navigate";
export interface DocumentReadingSession {
  scrollTop: number;
  states: Map<number, ReadingBlockState>;
  foldedHeadings: Set<string>;
  activePos?: number;
}
export interface DocumentReadingViewProps {
  doc: PMNode;
  source: string;
  sourceCopyLabel?: string;
  navigation?: ReactNode;
  session: DocumentReadingSession;
  fontSize: number;
  highlightActiveLine: boolean;
  showLineNumbers: boolean;
  doubleClickFold?: boolean;
  className?: string;
  label?: string;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onActivePosition?: (position: number) => void;
  onStateChange?: () => void;
  defaultCodeBlockWrap?: boolean;
  cjkLatinSpacing?: boolean;
  active?: boolean;
  toolsVisible?: boolean;
  showStatusBar?: boolean;
  focusMode?: boolean;
  saveStatus?: "clean" | "dirty" | "saving" | "saved" | "error";
  bookmarks?: readonly number[];
  onToggleBookmark?: (position: number) => void;
}

/** Read-only capability on the ordinary document renderer. No storage API,
 * database ID, file service or canonical-content callback is available here. */
export function DocumentReadingView({ doc, source, sourceCopyLabel = "复制原始文本", navigation = null, session, fontSize, highlightActiveLine, showLineNumbers, doubleClickFold = false, className = "", label = "文档渲染", onClick, onActivePosition, onStateChange, defaultCodeBlockWrap = true, cjkLatinSpacing = true, active = true, toolsVisible = true, showStatusBar = true, focusMode = false, saveStatus, bookmarks = [], onToggleBookmark }: DocumentReadingViewProps) {
  const content = useRef<HTMLDivElement>(null);
  const foldHosts = useRef(new Map<number, HTMLElement>());
  const callbacks = useRef({ onStateChange, onActivePosition });
  callbacks.current = { onStateChange, onActivePosition };
  const [revision, redraw] = useState(0);
  const [blockMenu, setBlockMenu] = useState<{ pos: number; number: number; trigger: HTMLButtonElement } | null>(null);
  const [menu, setMenu] = useState<(NotesMenuTarget & { selectedText: string }) | null>(null);
  const [notice, setNotice] = useState("");
  const [toolPanel, setToolPanel] = useState<"find" | "jump" | null>(null);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchOptions>({});
  const [matchIndex, setMatchIndex] = useState(0);
  const [jumpValue, setJumpValue] = useState("");
  const [jumpError, setJumpError] = useState("");
  const [foldMenu, setFoldMenu] = useState<HTMLButtonElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pendingAnchor = useRef<{ pos: number; top: number } | null>(null);
  const lastFold = useRef(0);
  const lastTap = useRef<{ pos: number; time: number; x: number; y: number } | null>(null);
  const touch = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const [extensions] = useState(() => [
    ...documentRenderingExtensions({ defaultWrap: defaultCodeBlockWrap }),
    ActiveLinePlugin, SearchHighlights, CjkLatinSpacing,
    ReadingBlockSession.configure({ states: session.states }),
    readonlyDocumentGuard(() => true),
    Extension.create({ name: "headingFoldHosts", addProseMirrorPlugins: () => [headingFoldAnchors(foldHosts.current)] }),
    HeadingFold.configure({ initialCollapsedKeys: [...session.foldedHeadings], onChange: keys => {
      session.foldedHeadings = new Set(keys);
      callbacks.current.onStateChange?.(); redraw(value => value + 1);
    } }),
  ]);
  const [initialDocument] = useState(() => doc.toJSON());
  const editor = useEditor({ extensions, content: initialDocument, editable: false, shouldRerenderOnTransaction: false,
    editorProps: { handlePaste: () => true, handleDrop: () => true,
      clipboardTextSerializer: (slice, view) => clipboardSliceToPlainText(slice, view.state.doc) } });
  const numbering = useNumberingDisplay();
  const showNumbers = numbering.blocks?.visible ?? showLineNumbers;
  const compact = useMobileViewport();
  const sections = useMemo(() => extractHeadingSections(doc), [doc]);
  const items = useMemo(() => extractDocumentOutline(doc), [doc]);
  const current = Math.min(doc.childCount, doc.resolve(Math.min(doc.content.size, session.activePos ?? 0)).index(0) + 1);
  const hover = useDocumentHoverPreview(() => editor?.state.doc ?? doc, editor && !editor.isDestroyed ? editor.view.dom : null);
  const restoring = useRef(false);
  const regex = useSearchRegex(options.regex === true);
  const searches = useMemo(() => {
    const error = options.regex ? regex.error || (!regex.ready ? "正在加载 Perl 正则引擎…" : searchPatternError(query, options)) : "";
    if (error) return { matches: [], error };
    try { return { matches: findSearchMatches(doc, query, false, options.caseSensitive === true, options), error: "" }; }
    catch (cause) { return { matches: [], error: String(cause) }; }
  }, [doc, query, options, regex.ready, regex.error]);
  const activeMatch = searches.matches[matchIndex % (searches.matches.length || 1)];
  const blockAt = useCallback((pos: number) => {
    let result = 0;
    doc.forEach((_node, at) => { if (at <= pos) result = at; });
    return result;
  }, [doc]);
  const nodeDOM = useCallback((pos: number) => editor?.view.nodeDOM(blockAt(pos)) as HTMLElement | null, [editor, blockAt]);
  const activate = useCallback((position: number) => {
    if (!editor) return;
    const pos = blockAt(position);
    session.activePos = pos;
    editor.view.dispatch(editor.state.tr.setMeta(activeLinePluginKey, { readingBlockPosition: pos }));
    callbacks.current.onActivePosition?.(position);
    redraw(value => value + 1);
  }, [editor, session, blockAt]);
  const setFolds = (keys: readonly string[]) => {
    if (!editor) return;
    content.current?.dispatchEvent(new Event(EDITOR_NAVIGATION_EVENT));
    editor.view.dispatch(editor.state.tr.setMeta(headingFoldPluginKey, { type: "set", keys }));
  };
  const foldAll = (keys: readonly string[]) => {
    let pos = session.activePos ?? 0;
    for (const section of sections) {
      if (keys.includes(section.key) && section.headingEnd <= pos && pos < section.end) pos = section.pos;
    }
    const node = nodeDOM(pos);
    if (node) pendingAnchor.current = { pos, top: node.getBoundingClientRect().top };
    setFolds(keys); activate(pos);
  };
  const toggleHeading = (pos: number) => {
    const section = headingSectionAtPosition(sections, pos), root = nodeDOM(pos);
    if (!section || section.end <= section.headingEnd) return;
    if (root) pendingAnchor.current = { pos, top: root.getBoundingClientRect().top };
    const keys = new Set(session.foldedHeadings);
    if (keys.has(section.key)) keys.delete(section.key); else keys.add(section.key);
    setFolds([...keys]); activate(section.pos);
  };
  const navigate = useCallback((position: number) => {
    if (!editor || !content.current) return;
    content.current.dispatchEvent(new Event(EDITOR_NAVIGATION_EVENT));
    const at = Math.max(0, Math.min(position, editor.state.doc.content.size));
    expandHeadingFoldsAt(editor, at);
    const root = nodeDOM(at);
    root?.querySelector<HTMLButtonElement>('button[aria-label="展开代码块"], button[aria-label="展开流程块"], button[aria-label="展开引用块"]')?.click();
    const details = root?.matches("details") ? root : root?.querySelector("details");
    if (details && !details.hasAttribute("open")) details.querySelector<HTMLElement>("summary")?.click();
    activate(at);
    if (root) content.current.scrollTop += root.getBoundingClientRect().top - content.current.getBoundingClientRect().top;
  }, [editor, nodeDOM, activate]);
  useEffect(() => {
    if (!editor) return;
    const selection = () => {
      const pos = editor.state.selection.from;
      session.activePos = blockAt(pos);
      callbacks.current.onActivePosition?.(pos);
      redraw(value => value + 1);
    };
    editor.on("selectionUpdate", selection);
    return () => { editor.off("selectionUpdate", selection); };
  }, [editor, session, blockAt]);
  useEffect(() => {
    if (!editor) return;
    setCodeBlockDefaultWrap(editor, defaultCodeBlockWrap);
    setCjkLatinSpacing(editor, cjkLatinSpacing && !supportsNativeCjkLatinSpacing());
  }, [editor, defaultCodeBlockWrap, cjkLatinSpacing]);
  useLayoutEffect(() => {
    if (active && content.current && editor) {
      const root = content.current;
      restoring.current = true;
      const stop = restoreDocumentViewport({ root, editor, scrollTop: session.scrollTop, onFinish: () => {
        restoring.current = false;
        session.scrollTop = root.scrollTop;
      } });
      if (session.activePos !== undefined) activate(session.activePos);
      return stop;
    }
  }, [active, editor, activate, session]);
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current;
    if (!anchor || !content.current) return;
    pendingAnchor.current = null;
    const node = nodeDOM(anchor.pos);
    if (node) content.current.scrollTop += node.getBoundingClientRect().top - anchor.top;
  }, [revision, nodeDOM]);
  useEffect(() => {
    if (!editor) return;
    setSearchHighlights(editor, searches.matches, matchIndex % (searches.matches.length || 1));
    if (!activeMatch) return;
    navigate(activeMatch.from);
    const frame = requestAnimationFrame(() => {
      const mark = editor.view.dom.querySelector<HTMLElement>(".search-match-active");
      if (mark && content.current) { mark.scrollIntoView({ block: "nearest", inline: "nearest" }); centerSearchMatch(content.current, mark.getBoundingClientRect()); }
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, searches, matchIndex, activeMatch, navigate]);
  useEffect(() => {
    const root = content.current;
    if (!root) return;
    const jump = (event: Event) => {
      const position = (event as CustomEvent<{ position?: number }>).detail?.position;
      if (Number.isSafeInteger(position)) navigate(position!);
    };
    root.addEventListener(DOCUMENT_READING_NAVIGATE_EVENT, jump);
    return () => root.removeEventListener(DOCUMENT_READING_NAVIGATE_EVENT, jump);
  });
  const showTool = useCallback((panel: "find" | "jump") => {
    setFoldMenu(null); setToolPanel(previous => previous === panel ? null : panel);
    if (panel === "jump") { setJumpValue(String(current)); setJumpError(""); }
  }, [current]);
  useNativeMenuActions({ "document.find": { run: () => showTool("find") }, "document.jump": { run: () => showTool("jump") } }, active);
  useEffect(() => {
    if (!active) { setToolPanel(null); setBlockMenu(null); setMenu(null); setFoldMenu(null); setQuery(""); return; }
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open], [aria-modal="true"], [role="menu"]')) return;
      if (isDocumentFindKeyEvent(event) || isEditorLineJumpKeyEvent(event)) {
        event.preventDefault(); event.stopImmediatePropagation(); showTool(isDocumentFindKeyEvent(event) ? "find" : "jump");
      } else if (event.key === "Escape" && toolPanel) {
        event.preventDefault(); event.stopImmediatePropagation(); setToolPanel(null); setQuery(""); content.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [active, toolPanel, showTool]);
  useLayoutEffect(() => { input.current?.focus({ preventScroll: true }); }, [toolPanel]);
  useEffect(() => {
    if (!notice || notice.includes("失败")) return;
    const timer = setTimeout(() => setNotice(""), 2200);
    return () => clearTimeout(timer);
  }, [notice]);
  const submitJump = () => {
    const number = Number(jumpValue);
    if (!Number.isInteger(number) || number < 1 || number > doc.childCount) { setJumpError(`请输入 1–${doc.childCount} 的块号`); return; }
    let position = 0;
    for (let index = 0; index < number - 1; index++) position += doc.child(index).nodeSize;
    navigate(position); setToolPanel(null);
  };
  const blockMenuActions = (): BlockMenuAction[] => {
    if (!blockMenu || !editor) return [];
    const node = editor.state.doc.nodeAt(blockMenu.pos);
    if (!node) return [];
    const actions: BlockMenuAction[] = (["formatted", "markdown", "text"] as const).map((mode, index) => ({ label: ["复制内容", "复制 Markdown", "复制纯文本"][index], run: () => { void copyDocumentBlock(editor.state.doc, blockMenu.pos, mode).then(() => setNotice("已复制此块"), () => setNotice("复制块失败，请重试")); } }));
    if (onToggleBookmark) actions.push({ label: bookmarks.some(pos => blockMenu.pos <= pos && pos < blockMenu.pos + node.nodeSize) ? "取消块书签" : "添加块书签", run: () => onToggleBookmark(blockMenu.pos) });
    actions.push({ label: "打开块模式", run: () => openBlockWorkspace(editor, blockMenu.pos, blockMenu.trigger) });
    const section = sections.find(item => item.pos === blockMenu.pos);
    if (section && section.end > section.headingEnd) actions.push({ label: "折叠 / 展开本节", run: () => toggleHeading(blockMenu.pos) });
    actions.push(...blockSpecificMenu(blockReadingActions(nodeDOM(blockMenu.pos), node.type.name)));
    return actions;
  };
  const handleFold = (event: MouseEvent<HTMLDivElement>) => {
    if (!doubleClickFold || !(event.target instanceof Element) || event.target.closest("button,a,input,select,textarea")) return;
    if (Date.now() - lastFold.current < 350) return;
    const hit = editor?.view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!hit) return;
    event.preventDefault(); lastFold.current = Date.now(); document.getSelection()?.removeAllRanges(); toggleHeading(hit.pos);
  };
  return <DocumentOutlineContext.Provider value={{ items, navigate: item => navigate(item.pos) }}><div className="document-reading-surface">
    {toolsVisible && <div className="editor-menu document-reading-tools" role="toolbar" aria-label="文档阅读工具">
      <button type="button" className="menu-btn" aria-label="文档查找" title="文档查找（⌘F / Ctrl+F）" aria-pressed={toolPanel === "find"} onClick={() => showTool("find")}><ToolbarIcon name="search" /></button>
      <button type="button" className="menu-btn" aria-label="跳转块" title="跳转块（⌘G / Ctrl+G）" aria-pressed={toolPanel === "jump"} onClick={() => showTool("jump")}><ToolbarIcon name="jumpLine" /></button>
      <button type="button" className="menu-btn" aria-label="折叠全部标题" title="折叠全部标题" disabled={!sections.length} aria-pressed={session.foldedHeadings.size > 0} onClick={() => foldAll(collapsedHeadingKeysForAll(sections))}><ToolbarIcon name="minus" /></button>
      <button type="button" className="menu-btn" aria-label="展开全部标题" title="展开全部标题" disabled={!sections.length} aria-pressed={session.foldedHeadings.size === 0} onClick={() => foldAll([])}><ToolbarIcon name="plus" /></button>
      {new Set(sections.map(section => section.level)).size > 1 && <button type="button" className="menu-btn toolbar-split-caret" aria-label="选择标题折叠级别" title="选择标题折叠级别" onClick={event => setFoldMenu(previous => previous ? null : event.currentTarget)}>▾</button>}
    </div>}
    {toolPanel === "find" && <div className="editor-find-bar" role="search" aria-label="文档查找">
      <div className="editor-find-header"><span>文档查找</span><button type="button" aria-label="关闭查找" className="editor-find-close" onClick={() => { setToolPanel(null); setQuery(""); }}>×</button></div>
      <div className="editor-find-row"><input ref={input} value={query} aria-label="在当前文档中查找" placeholder="在当前文档中查找" onChange={event => { setQuery(event.target.value); setMatchIndex(0); }} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); setMatchIndex(index => index + (event.shiftKey ? -1 : 1) + searches.matches.length); } }} />
        <span className="editor-find-count" role="status">{searches.matches.length ? `${matchIndex % searches.matches.length + 1}/${searches.matches.length}` : "0/0"}</span>
        <button type="button" disabled={!searches.matches.length} aria-label="上一处匹配" onClick={() => setMatchIndex(index => index - 1 + searches.matches.length)}>↑</button><button type="button" disabled={!searches.matches.length} aria-label="下一处匹配" onClick={() => setMatchIndex(index => index + 1)}>↓</button>
      </div><div className="editor-find-options">{(["caseSensitive", "wholeWord", "regex"] as const).map((key, index) => <label key={key}><input type="checkbox" checked={options[key] === true} onChange={event => { setOptions(previous => ({ ...previous, [key]: event.target.checked })); setMatchIndex(0); }} />{["区分大小写", "全词匹配", "正则表达式（Perl）"][index]}</label>)}</div>
      {searches.error && <p role="alert" className="search-pattern-error">{searches.error}</p>}
    </div>}
    {toolPanel === "jump" && <form className="editor-line-jump" role="dialog" aria-label="跳转块" onSubmit={event => { event.preventDefault(); submitJump(); }}>
      <label>块号<input ref={input} aria-label="跳转到块号" inputMode="numeric" value={jumpValue} onChange={event => { setJumpValue(event.target.value); setJumpError(""); }} /></label>
      <span role="status" className={jumpError ? "editor-line-jump-error" : "editor-line-jump-range"}>{jumpError || `/ ${doc.childCount}`}</span><button type="submit">跳转</button><button type="button" className="btn-icon" aria-label="关闭跳转块" onClick={() => setToolPanel(null)}>×</button>
    </form>}
    <div ref={content} className={`note-editor-scroll document-reading-view ${className}${showNumbers ? " show-line-numbers" : ""}${highlightActiveLine ? "" : " no-active-line"}${cjkLatinSpacing ? " editor-auto-cjk-spacing" : ""}`} aria-label={label} tabIndex={0} style={{ "--editor-font-size": `${fontSize}px` } as CSSProperties}
      onScroll={event => { if (active && !restoring.current) session.scrollTop = event.currentTarget.scrollTop; }}
      onClick={event => {
        if (event.target instanceof Element && event.target.closest("button,input,select,textarea")) return;
        if (event.detail >= 3 && Date.now() - lastFold.current < 450) return;
        const heading = headingLinkTarget(event.target, items, doc);
        if (heading) { event.preventDefault(); navigate(heading.pos); return; }
        const footnote = footnoteLinkTarget(event.target);
        if (footnote) { event.preventDefault(); scrollToFootnote(event.currentTarget, footnote); return; }
        const hit = editor?.view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (hit) activate(hit.pos);
        onClick?.(event);
      }}
      onDoubleClick={handleFold}
      onMouseDown={event => { if (doubleClickFold && event.detail >= 2 && event.target instanceof Element && !event.target.closest("button,a,input,select,textarea")) event.preventDefault(); }}
      onPointerDown={event => { if (event.pointerType === "touch") touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; }}
      onPointerMove={event => { if (touch.current && Math.hypot(event.clientX - touch.current.x, event.clientY - touch.current.y) > 12) touch.current.moved = true; }}
      onPointerCancel={() => { touch.current = null; lastTap.current = null; }}
      onPointerUp={event => {
        const gesture = touch.current; touch.current = null;
        if (!doubleClickFold || event.pointerType !== "touch" || !gesture || gesture.id !== event.pointerId || gesture.moved || !(event.target instanceof Element) || event.target.closest("button,a,input,select,textarea")) return;
        const hit = editor?.view.posAtCoords({ left: event.clientX, top: event.clientY });
        const section = hit && headingSectionAtPosition(sections, hit.pos);
        if (!section) return;
        const previous = lastTap.current, now = Date.now();
        if (previous && previous.pos === section.pos && now - previous.time < 350 && Math.hypot(previous.x - event.clientX, previous.y - event.clientY) < 24) {
          event.preventDefault(); lastTap.current = null; lastFold.current = now; document.getSelection()?.removeAllRanges(); toggleHeading(section.pos);
        } else lastTap.current = { pos: section.pos, time: now, x: event.clientX, y: event.clientY };
      }}
      onContextMenu={event => {
        event.preventDefault(); const selection = document.getSelection();
        const selectedText = selection && !selection.isCollapsed && selection.anchorNode && event.currentTarget.contains(selection.anchorNode) ? selection.toString() : "";
        setMenu({ id: "document-reading", title: "文档渲染", x: event.clientX, y: event.clientY, trigger: event.currentTarget, selectedText });
      }}>
      {editor && <DocumentRenderBody editor={editor} style={{ "--editor-gutter-width": `${editorGutterWidth(doc.childCount, showNumbers, compact)}px` } as CSSProperties}
        gutter={<EditorBlockGutter editor={editor} foldHosts={foldHosts.current} compact={compact} showNumbers={showNumbers} readonly showInsertButtons={false} bookmarkPositions={bookmarks}
          onHeadingFoldToggle={toggleHeading} onBlockMenu={(pos, trigger, number) => { activate(pos); setBlockMenu(previous => previous?.pos === pos ? null : { pos, number, trigger }); }} />}
        onPointerOver={hover.onPointerOver} onPointerOut={hover.onPointerOut} onFocusCapture={hover.onFocusCapture} onBlurCapture={hover.onBlurCapture} onScrollCapture={hover.onScrollCapture} />}
      {hover.preview}
      <CopyBlockNotice message={notice} onClose={() => setNotice("")} />
    </div>
    <EditorStatusBar enabled={showStatusBar} focusMode={focusMode} saveStatus={saveStatus} blockPosition={{ current, total: doc.childCount }} characters={doc.textContent.length} navigation={navigation} />
    {editor && active && <BlockWorkspaceHost source={editor} readonly highlightActiveLine={highlightActiveLine} />}
    {blockMenu && <BlockActionMenu title={`第 ${blockMenu.number} 块`} blockNumber={blockMenu.number} blockType={doc.nodeAt(blockMenu.pos)?.type.name} trigger={blockMenu.trigger} actions={blockMenuActions()} onClose={() => setBlockMenu(null)} />}
    {foldMenu && <BlockActionMenu title="标题折叠级别" trigger={foldMenu} actions={[...new Set(sections.map(section => section.level))].sort().map(level => ({ label: `显示至 H${level}`, run: () => setFolds(sections.filter(section => section.level >= level && section.end > section.headingEnd).map(section => section.key)) }))} onClose={() => setFoldMenu(null)} />}
    {menu && <NotesContextMenu target={menu} close={() => setMenu(null)} actions={menu.selectedText ? [{ label: "复制选中文本", run: () => { void copyToClipboard(menu.selectedText, { reportFailure: true }); } }] : [
      { label: sourceCopyLabel, run: () => { void copyToClipboard(source, { reportFailure: true }); } },
      { label: "选择全部文本", run: () => { if (editor) { const range = document.createRange(); range.selectNodeContents(editor.view.dom); const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); } } },
    ]} />}
  </div></DocumentOutlineContext.Provider>;
}
