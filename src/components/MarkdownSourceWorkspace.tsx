import { useDocumentActive } from "./RetainedDocument";
import { useNativeMenuActions } from "../hooks/useNativeMenuActions";
import { ToolbarIcon } from "./ToolbarIcon";
import { DocumentPanelTitle, OutlinePanelTitle } from "./OutlinePanelTitle";
import { PanelDisplayTools, revealPanelItem } from "./PanelDisplayTools";
import { panelDisplayStyle, sortedBookmarks } from "../lib/panel-display-view";
import type { CSSProperties } from "react";
import { usePanelDisplay } from "../hooks/usePanelDisplay";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { SourceEditorHandle } from "../lib/source-editor-handle";
import { useMobileViewport } from "../hooks/useEdgeDrawer";
import { useDesktopDocumentPanels } from "../hooks/useDesktopDocumentPanels";
import { useDocumentPanelPosition } from "../hooks/useDocumentPanelPosition";
import { EditorView } from "@codemirror/view";
import {
  SourceNavigationDocument,
  sourceEditMapping,
} from "../lib/markdown-source-navigation";
import {
  DesktopDocumentPanels,
  desktopPanelClass,
  desktopPanelStyle,
} from "./DesktopDocumentPanels";
import { DocumentOutlineList, OutlineDisplayTools, OUTLINE_SCROLL_EVENT } from "./DocumentOutlineList";
import { FocusModeIcon } from "./FocusModeBar";
import { DocumentBookmarkRow } from "./DocumentBookmarkRow";
import { SourceEditorContextMenu, type SourceContextTarget } from "./SourceEditorContextMenu";
import { BookmarkRenameDialog } from "./BookmarkRenameDialog";
import { extractCSourceSymbols } from "../lib/source-symbols";
import { focusSourceWordMatch, groupSourceWordMatchesByLine, selectSourceWordAt, sourceWordState } from "../lib/source-word-occurrences";
import type { DocumentOutlineItem } from "../lib/document-outline";
import type { DocumentBookmark } from "../types/models";

type SourceOutlineItem = DocumentOutlineItem & { offset: number };

function alphabetizeSymbolTree(items: SourceOutlineItem[]): SourceOutlineItem[] {
  type Branch = { item: SourceOutlineItem; children: Branch[] };
  const roots: Branch[] = [];
  const stack: Array<{ level: number; children: Branch[] }> = [{ level: 0, children: roots }];
  for (const item of items) {
    while (stack.length > 1 && stack[stack.length - 1]!.level >= item.level) stack.pop();
    const branch: Branch = { item, children: [] };
    stack[stack.length - 1]!.children.push(branch);
    stack.push({ level: item.level, children: branch.children });
  }
  const result: SourceOutlineItem[] = [];
  const visit = (branches: Branch[]) => {
    branches.sort((left, right) => (left.item.displayText ?? left.item.text).localeCompare(right.item.displayText ?? right.item.text, "zh-CN", { numeric: true, sensitivity: "base" }));
    for (const branch of branches) { result.push(branch.item); visit(branch.children); }
  };
  visit(roots);
  return result;
}

const SOURCE_KIND_MARKERS: Record<string, string> = {
  "命名空间": "◇",
  "类型": "{}",
  "别名": "T",
  "函数": "ƒ",
  "变量": "v",
  "成员": "·",
  "枚举值": "e",
};

export function MarkdownSourceWorkspace({
  revision,
  areaRef,
  sourceHandle,
  onJump,
  onToggleBookmark,
  onRemoveBookmark,
  onRenameBookmark,
  children,
}: {
  revision: SourceNavigationDocument;
  areaRef: RefObject<SourceEditorHandle>;
  sourceHandle: SourceEditorHandle | null;
  onJump: (offset: number) => void;
  onToggleBookmark: (offset: number) => void;
  onRemoveBookmark: (id: string) => void;
  onRenameBookmark: (id: string, label: string) => void;
  children: (controls: ReactNode) => ReactNode;
}) {
  const documentActive = useDocumentActive();
  const mobile = useMobileViewport();
  const outlineDisplayConfig = usePanelDisplay("document-outline");
  const sourceSymbolDisplayConfig = usePanelDisplay("source-symbols");
  const sourceMatchDisplayConfig = usePanelDisplay("source-matches");
  const bookmarkDisplayConfig = usePanelDisplay("bookmarks");
  const bookmarkDisplayListRef = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState(revision);
  const snapshotSource = snapshot.source;
  const snapshotLanguage = snapshot.language;
  const [sourceSymbols, setSourceSymbols] = useState<SourceOutlineItem[]>([]);
  const [symbolsBusy, setSymbolsBusy] = useState(false);
  const [symbolsAlphabetical, setSymbolsAlphabetical] = useState(false);
  const [offset, setOffset] = useState(0);
  const [folds, setFolds] = useState<Set<number>>(() => new Set());
  const [renamingBookmark, setRenamingBookmark] = useState<DocumentBookmark | null>(null);
  const [openBookmarkActionsId, setOpenBookmarkActionsId] = useState<string | null>(null);
  const [matchesOpen, setMatchesOpen] = useState(false);
  const [matchesPreview, setMatchesPreview] = useState(false);
  const matchesTrigger = useRef<HTMLButtonElement>(null);
  const matchesPanel = useRef<HTMLElement>(null);
  const matchesTimer = useRef<ReturnType<typeof setTimeout>>();
  const cancelMatchesPreview = () => clearTimeout(matchesTimer.current);
  const leaveMatchesPreview = () => {
    cancelMatchesPreview();
    matchesTimer.current = setTimeout(() => setMatchesPreview(false), 220);
  };
  useEffect(() => () => clearTimeout(matchesTimer.current), []);

  useEffect(() => {
    if (!matchesPreview) return;
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && event.target instanceof Node && (matchesPanel.current?.contains(event.target) || matchesTrigger.current?.contains(event.target))) return;
      setMatchesPreview(false);
    };
    document.addEventListener("click", dismiss);
    window.addEventListener("keydown", dismiss);
    return () => { document.removeEventListener("click", dismiss); window.removeEventListener("keydown", dismiss); };
  }, [matchesPreview]);
  const matchesStyle = useDocumentPanelPosition({ open: matchesPreview && !matchesOpen, compact: false, triggerRef: matchesTrigger, panelRef: matchesPanel });
  const [sourceContextMenu, setSourceContextMenu] = useState<SourceContextTarget | null>(null);
  const closeSourceContextMenu = useCallback(() => setSourceContextMenu(null), []);
  useEffect(closeSourceContextMenu, [closeSourceContextMenu, documentActive, sourceHandle]);
  const [, refreshMatches] = useState(0);
  useEffect(() => {
    // Coalesce typing and reuse the same lazy parse as autosave; no hidden rich editor.
    if (mobile) return;
    const previousBookmarks = snapshot.bookmarks.map(item => `${item.id}:${item.position}:${item.label ?? ""}`).join("|");
    const nextBookmarks = revision.bookmarks.map(item => `${item.id}:${item.position}:${item.label ?? ""}`).join("|");
    if (snapshot.source === revision.source && previousBookmarks !== nextBookmarks) {
      setSnapshot(revision);
      return;
    }
    const timer = setTimeout(() => {
      setSnapshot(revision);
      setFolds(new Set());
    }, 160);
    return () => clearTimeout(timer);
  }, [revision, mobile, snapshot]);
  useEffect(() => {
    if (mobile || snapshotLanguage !== "c") {
      setSourceSymbols([]);
      setSymbolsBusy(false);
      return;
    }
    const controller = new AbortController();
    setSourceSymbols([]);
    setSymbolsBusy(true);
    const timer = setTimeout(() => {
      void extractCSourceSymbols(snapshotSource, controller.signal)
        .then((symbols) => {
          if (!controller.signal.aborted && symbols) {
            setSourceSymbols(symbols.map((symbol) => ({
              ...symbol,
              kindSymbol: SOURCE_KIND_MARKERS[symbol.kind],
              displayText: symbol.displayText ?? symbol.text,
              offset: symbol.pos,
            })));
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setSourceSymbols([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSymbolsBusy(false);
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [snapshotSource, snapshotLanguage, mobile]);
  useEffect(() => {
    const area = sourceHandle;
    if (!area || mobile) return;
    const sync = () => setOffset(area.selectionStart);
    sync();
    area.addEventListener("select", sync);
    area.addEventListener("keyup", sync);
    area.addEventListener("click", sync);
    return () => {
      area.removeEventListener("select", sync);
      area.removeEventListener("keyup", sync);
      area.removeEventListener("click", sync);
    };
  }, [sourceHandle, mobile]);
  const sourceWordEnabled = !["", "markdown", "flow", "mermaid"].includes(snapshotLanguage);
  useEffect(() => {
    if (matchesOpen || !documentActive || mobile || !sourceWordEnabled) {
      clearTimeout(matchesTimer.current);
      setMatchesPreview(false);
    }
  }, [matchesOpen, documentActive, mobile, sourceWordEnabled]);
  const symbolOutline = snapshotLanguage === "c";
  const sortedSourceSymbols = useMemo(
    () => symbolsAlphabetical ? alphabetizeSymbolTree(sourceSymbols) : sourceSymbols,
    [sourceSymbols, symbolsAlphabetical],
  );
  const outline = useMemo<SourceOutlineItem[]>(
    () => mobile ? [] : symbolOutline ? sortedSourceSymbols : snapshot.outline.map((item) => ({ ...item, kind: undefined })),
    [snapshot, mobile, sortedSourceSymbols, symbolOutline],
  );
  const bookmarks = useMemo(() => (mobile ? [] : revision.bookmarks), [revision, mobile]);
  const nearestBookmark = bookmarks.reduce<(typeof bookmarks)[number] | undefined>((current, item) => !current || Math.abs(item.offset - offset) < Math.abs(current.offset - offset) ? item : current, undefined);
  const currentSourceBlock = revision.blockAt(offset);
  const currentBookmark = bookmarks.find(bookmark => bookmark.position === (currentSourceBlock?.position ?? -2) + 1);
  const controller = useDesktopDocumentPanels(!mobile, outline, bookmarks, [], symbolOutline ? 35 : undefined);
  const dismissPanelPreview = controller.dismiss;
  useEffect(() => {
    const view = sourceHandle?.view;
    if (!view || mobile || !sourceWordEnabled) return;
    const update = () => refreshMatches(value => value + 1);
    view.dom.addEventListener("nr:source-word-update", update);
    return () => view.dom.removeEventListener("nr:source-word-update", update);
  }, [sourceHandle, mobile, sourceWordEnabled]);
  useEffect(() => {
    if (mobile || !sourceWordEnabled) {
      setMatchesOpen(false);
      return;
    }
    const openMatches = (event: Event) => {
      const detail = (event as CustomEvent<{ from: number }>).detail;
      if (!detail) return;
      setOffset(detail.from);
      setMatchesOpen(true);
      dismissPanelPreview();
    };
    window.addEventListener("nr:source-word-open", openMatches);
    return () => {
      window.removeEventListener("nr:source-word-open", openMatches);
    };
  }, [mobile, sourceWordEnabled, dismissPanelPreview]);
  useEffect(() => {
    if (mobile || !sourceWordEnabled) return;
    const modifierClick = (event: globalThis.MouseEvent) => {
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return;
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".cm-content")) return;
      const editorRoot = target.closest<HTMLElement>(".cm-editor");
      const view = sourceHandle?.view ?? areaRef.current?.view ?? (editorRoot ? EditorView.findFromDOM(editorRoot) : null);
      if (!view) return;
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position === null) return;
      const range = selectSourceWordAt(view, position);
      if (!range) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.dispatchEvent(new CustomEvent("nr:source-word-open", { detail: { from: range.from } }));
    };
    document.addEventListener("mousedown", modifierClick, true);
    return () => document.removeEventListener("mousedown", modifierClick, true);
  }, [areaRef, sourceHandle, mobile, sourceWordEnabled]);
  const wordState = sourceWordEnabled && sourceHandle ? sourceWordState(sourceHandle.view) : null;
  const groupedWordMatches = useMemo(() => groupSourceWordMatchesByLine(wordState?.matches ?? []), [wordState?.matches]);
  const outlineTrigger = useRef<HTMLButtonElement>(null),
    bookmarkTrigger = useRef<HTMLButtonElement>(null);
  const outlinePanel = useRef<HTMLElement>(null),
    bookmarkPanel = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const kind = controller.preview;
  const style = useDocumentPanelPosition({
    open: Boolean(kind),
    compact: false,
    triggerRef: kind === "bookmark" ? bookmarkTrigger : outlineTrigger,
    panelRef: kind === "bookmark" ? bookmarkPanel : outlinePanel,
    width: controller.widths[kind ?? "outline"],
    layoutKey: kind ?? "",
  });
  const active = outline.reduce(
    (index, item, i) => (item.offset <= offset ? i : index),
    -1,
  );
  const entries = useMemo(() => {
    let hiddenBelow = 7;
    return outline.flatMap((item, index) => {
      if (item.level > hiddenBelow) return [];
      hiddenBelow = folds.has(item.pos) ? item.level : 7;
      return [{ item, index, folded: folds.has(item.pos), foldable: outline[index + 1]?.level > item.level }];
    });
  }, [outline, folds]);
  const jump = (target: number) => {
    const next = sourceEditMapping(snapshot.source, revision.source)(target);
    onJump(next);
    setOffset(next);
    controller.dismiss();
  };
  const jumpSourceSymbol = async (item: SourceOutlineItem) => {
    const liveSource = () => sourceHandle?.value ?? revision.source;
    const currentSource = liveSource();
    let targetSource = currentSource;
    let next = item.offset;
    if (snapshot.source !== currentSource) {
      // The outline parse is intentionally debounced. If the user clicks during
      // that short window, re-resolve the symbol against the latest buffer by
      // semantic identity, preferring the occurrence nearest the mapped offset.
      let resolved = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const parsedSource = liveSource();
        const approximateOffset = sourceEditMapping(snapshot.source, parsedSource)(item.offset);
        const latest = await extractCSourceSymbols(parsedSource);
        if (liveSource() !== parsedSource) continue;
        const candidates = latest?.filter(symbol => symbol.kind === item.kind && symbol.identity === item.identity) ?? [];
        if (!candidates.length) return; // The old row was renamed or deleted.
        next = candidates.reduce((best, symbol) => Math.abs(symbol.pos - approximateOffset) < Math.abs(best.pos - approximateOffset) ? symbol : best).pos;
        targetSource = parsedSource;
        resolved = true;
        break;
      }
      // If the source kept changing while it was parsed, do not guess an offset.
      if (!resolved) return;
    }
    const latestSource = liveSource();
    // A final edit may land between parse and navigation. Reparse is required
    // to preserve identity, so defer instead of using an offset from old text.
    if (latestSource !== targetSource) return;
    const safeOffset = Math.max(0, Math.min(latestSource.length, next));
    onJump(safeOffset);
    setOffset(safeOffset);
    controller.dismiss();
  };
  useNativeMenuActions({
    "document.outline": { run: () => controller.toggle("outline"), checked: controller.pinned("outline") || controller.preview === "outline", enabled: outline.length > 0 },
    "document.bookmarks": { run: () => controller.toggle("bookmark"), checked: controller.pinned("bookmark") || controller.preview === "bookmark" },
  }, documentActive);
  const controls = mobile ? null : (
    <>
      {(["outline", "bookmark"] as const).map((kind) => (
        <button
          key={kind}
          ref={kind === "outline" ? outlineTrigger : bookmarkTrigger}
          type="button"
          className="btn-icon"
          title={kind === "outline" ? (symbolOutline ? "源码符号" : "文档目录") : "文档书签"}
          aria-label={kind === "outline" ? (symbolOutline ? "源码符号" : "文档目录") : "文档书签"}
          aria-expanded={controller.pinned(kind) || controller.preview === kind}
          data-document-panel-trigger={kind}
          data-pinned={controller.pinned(kind)}
          onPointerEnter={(event) => { cancelMatchesPreview(); setMatchesPreview(false); controller.enter(kind, event.pointerType); }}
          onPointerLeave={controller.leave}
          onClick={() => { setOffset(sourceHandle?.selectionStart ?? offset); controller.toggle(kind); }}
        >
          <FocusModeIcon name={kind} />
        </button>
      ))}
      {sourceWordEnabled && <button
        type="button"
        className="btn-icon"
        title={`同词匹配：显示或隐藏匹配列表（${/Mac/i.test(navigator.platform) ? "⌘" : "Ctrl"}+单击单词可直接打开）`}
        aria-label="同词匹配"
        ref={matchesTrigger}
        aria-expanded={matchesOpen || matchesPreview}
        aria-pressed={matchesOpen}
        data-document-panel-trigger="matches"
        onPointerEnter={event => { if (event.pointerType !== "mouse" || matchesOpen) return; cancelMatchesPreview(); matchesTimer.current = setTimeout(() => { dismissPanelPreview(); setMatchesPreview(true); }, 140); }}
        onPointerLeave={leaveMatchesPreview}
        onClick={() => { cancelMatchesPreview(); setMatchesPreview(false); dismissPanelPreview(); setMatchesOpen(open => !open); }}
      ><ToolbarIcon name="search" /></button>}
    </>
  );
  const renderPanel = (kind: "outline" | "bookmark") => {
    if (!controller.pinned(kind) && controller.preview !== kind) return null;
    const isOutline = kind === "outline";
    return (
      <nav
        ref={isOutline ? outlinePanel : bookmarkPanel}
        className={
          isOutline ? "document-outline-panel" : `document-bookmark-panel${bookmarks.length ? "" : " is-empty"}`
        }
        aria-label={isOutline ? (symbolOutline ? "源码符号" : "文档目录") : "文档书签"}
        aria-busy={snapshot !== revision}
        style={controller.pinned(kind) ? undefined : style}
        data-document-preview={!controller.pinned(kind) || undefined}
        onPointerEnter={controller.cancel}
        onPointerLeave={controller.leave}
      >
        <div
          className={
            isOutline ? "document-outline-header" : "document-bookmark-header"
          }
        >
          <div className="document-outline-header-primary">{isOutline ? (symbolOutline ? <DocumentPanelTitle label="源码符号" pinned={controller.pinned(kind)} onCollapse={() => controller.toggle(kind)} /> : <OutlinePanelTitle pinned={controller.pinned(kind)} onCollapse={() => controller.toggle(kind)} />) : <DocumentPanelTitle label="书签" pinned={controller.pinned(kind)} onCollapse={() => controller.toggle(kind)} />}
            {isOutline && <>
              <OutlineDisplayTools listRef={listRef} target={symbolOutline ? "source-symbols" : "document-outline"} targetLabel={symbolOutline ? "定位当前符号" : "定位当前标题"} />
              {symbolOutline && <button type="button" className="btn-icon" aria-label={symbolsAlphabetical ? "按源码出现顺序排序" : "按字母顺序排序"} title={symbolsAlphabetical ? "按源码出现顺序排序" : "按字母顺序排序"} aria-pressed={symbolsAlphabetical} onClick={() => setSymbolsAlphabetical(value => !value)}><ToolbarIcon name="sortAlpha" /></button>}
              <button type="button" aria-label="全部折叠" title="折叠目录" onClick={() => setFolds(new Set(outline.filter((item, i) => outline[i + 1]?.level > item.level).map(item => item.pos)))}>−</button>
              <button type="button" aria-label="全部展开" title="展开目录" onClick={() => setFolds(new Set())}>+</button>
            </>}
          </div>
          <div className="document-outline-header-actions">
            {!isOutline && <>
              <PanelDisplayTools target="bookmarks" disabled={!nearestBookmark} handlers={{ "bookmarks.reveal-current": () => revealPanelItem(bookmarkDisplayListRef.current, nearestBookmark?.id) }} />
              {!currentBookmark && <button className="document-bookmark-add" type="button" onClick={() => onToggleBookmark(offset)} aria-label="添加当前位置书签">添加</button>}
            </>}
          {isOutline && !symbolOutline && <div className="document-outline-jumps" aria-label="目录快速滚动">{(["top", "middle", "bottom"] as const).map((target, i) => <button type="button" key={target} title={["滚动至顶部", "滚动至中部", "滚动至底部"][i]} aria-label={["滚动至顶部", "滚动至中部", "滚动至底部"][i]} onClick={() => listRef.current?.dispatchEvent(new CustomEvent(OUTLINE_SCROLL_EVENT, { detail: target }))}>{<ToolbarIcon name={(["pageTop", "pageMiddle", "pageBottom"] as const)[i]} />}</button>)}</div>}
          {(isOutline ? (symbolOutline ? sourceSymbolDisplayConfig?.showCounts === true : outlineDisplayConfig?.showCounts !== false) : bookmarkDisplayConfig?.showCounts !== false) && <span className={isOutline ? "document-outline-count" : "document-bookmark-count"}>
            {isOutline ? outline.length : bookmarks.length} 项
          </span>}
          {!controller.pinned(kind) && <button type="button" className="btn-icon document-panel-pin-button" onClick={() => controller.toggle(kind)} aria-label={isOutline ? (symbolOutline ? "固定源码符号" : "固定目录") : "固定书签"} title={isOutline ? (symbolOutline ? "固定源码符号" : "固定目录") : "固定书签"}>
            <ToolbarIcon name="pin" />
          </button>}
          </div>
        </div>
        {isOutline ? (
          outline.length ? (
            <DocumentOutlineList
              entries={entries}
              followActive
              activeOutlineIndex={active}
              compactSymbols={symbolOutline}
              displayTarget={symbolOutline ? "source-symbols" : "document-outline"}
              outlineBaseLevel={outline.reduce(
                (level, item) => Math.min(level, item.level),
                6,
              )}
              listRef={listRef}
              onToggleFold={(pos) =>
                setFolds((previous) => {
                  const next = new Set(previous);
                  if (next.has(pos)) next.delete(pos);
                  else next.add(pos);
                  return next;
                })
              }
              onJump={(item) => symbolOutline
                ? void jumpSourceSymbol(item as SourceOutlineItem)
                : jump(outline.find((heading) => heading.pos === item.pos)?.offset ?? item.pos)}
            />
          ) : (
            <div className="document-bookmark-empty">{symbolOutline ? (symbolsBusy ? "正在分析源码符号…" : "当前文件没有可显示的符号") : "当前文档还没有标题"}</div>
          )
        ) : bookmarks.length > 0 ? (
          <div className="document-bookmark-list" ref={bookmarkDisplayListRef} data-panel-display={bookmarkDisplayConfig ? "plugin" : undefined} style={panelDisplayStyle(bookmarkDisplayConfig) as CSSProperties}>
            {sortedBookmarks(bookmarks, bookmarkDisplayConfig).map((bookmark) => (
                <DocumentBookmarkRow
                  key={bookmark.id}
                  bookmark={bookmark}
                  display={bookmarkDisplayConfig}
                  blockNumber={bookmark.blockNumber}
                  current={currentBookmark?.id === bookmark.id}
                  mobile={false}
                  open={openBookmarkActionsId === bookmark.id}
                  onOpenChange={setOpenBookmarkActionsId}
                  onJump={() => { onJump(bookmark.offset); controller.dismiss(); }}
                  onEdit={() => setRenamingBookmark(bookmark)}
                  onDelete={() => onRemoveBookmark(bookmark.id)}
                />
              ))}
          </div>
        ) : null}
      </nav>
    );
  };
  const matchesList = sourceWordEnabled && <nav ref={matchesPanel} data-document-preview={!matchesOpen || undefined} onPointerEnter={cancelMatchesPreview} onPointerLeave={leaveMatchesPreview} className={`document-source-matches-panel${matchesOpen ? "" : " document-source-matches-preview"}`} aria-label="同词匹配列表" data-panel-display={sourceMatchDisplayConfig ? "plugin" : undefined} style={{ ...panelDisplayStyle(sourceMatchDisplayConfig), ...(!matchesOpen ? matchesStyle : undefined) } as CSSProperties}>
            <div className="document-outline-header document-source-matches-header">
              <div className="document-outline-header-primary"><span>{wordState?.word ? `“${wordState.word}”${sourceMatchDisplayConfig?.showCounts === false ? "" : ` · ${wordState.matches.length} 处`}` : "同词匹配"}</span></div>
              <div className="document-outline-header-actions"><button type="button" aria-label="隐藏匹配列表" title="隐藏匹配列表" onClick={() => { setMatchesOpen(false); setMatchesPreview(false); }}><ToolbarIcon name="close" /></button></div>
            </div>
            <div className="document-source-matches-list">
              {groupedWordMatches.length ? groupedWordMatches.map(group => {
                const active = group.matches.find(match => match.from === wordState?.activeFrom);
                const target = active ?? group.matches[0]!;
                return <button
                key={group.line}
                type="button"
                className="document-source-match-row"
                style={sourceMatchDisplayConfig ? { minHeight: `${sourceMatchDisplayConfig.rowHeight}px`, fontFamily: sourceMatchDisplayConfig.font === "mono" ? "var(--font-mono)" : sourceMatchDisplayConfig.font === "sans" ? "var(--font)" : undefined, fontSize: `${sourceMatchDisplayConfig.fontSize}px`, color: sourceMatchDisplayConfig.labelColor === "secondary" ? "var(--text-secondary)" : sourceMatchDisplayConfig.labelColor === "accent" ? "var(--accent)" : undefined } : undefined}
                aria-current={active ? "location" : undefined}
                aria-label={`第 ${group.line} 行${group.matches.length > 1 ? `，${group.matches.length} 处匹配` : ""}`}
                onClick={() => {
                  if (!sourceHandle) return;
                  focusSourceWordMatch(sourceHandle.view, target);
                  sourceHandle.scrollToOffset(target.from, true);
                  setOffset(target.from);
                }}
                title={`${group.line}: ${group.text}${group.matches.length > 1 ? ` · ${group.matches.length} 处匹配` : ""}`}
              ><span className={`document-source-match-line${group.matches.length > 1 ? " is-repeated" : ""}`}>{group.matches.length > 1 ? <strong>{group.line}</strong> : group.line}</span><code>{group.text || wordState?.word}</code></button>;
              }) : <div className="document-bookmark-empty">{wordState?.word ? "当前文档没有其它全词匹配" : "单击源码中的单词以查找相同词"}</div>}
            </div>
          </nav>;
  return (
    <section
      className={`note-editor markdown-source-editor ${desktopPanelClass(controller, true, matchesOpen && sourceWordEnabled)}`}
      style={desktopPanelStyle(controller)}
      aria-label="Markdown 源码编辑区"
      onClickCapture={event => {
        if (!sourceHandle || !(event.target instanceof Element)) return;
        const number = event.target.closest(".cm-lineNumbers .cm-gutterElement");
        if (!number || !number.textContent?.trim()) return;
        event.preventDefault(); event.stopPropagation();
        const view = sourceHandle.view;
        const block = view.lineBlockAtHeight(event.clientY - view.documentTop);
        const line = view.state.doc.lineAt(block.from);
        setSourceContextMenu(previous => previous?.lineNumber === line.number ? null : {
          x: event.clientX, y: event.clientY, view, readonly: view.state.readOnly,
          trigger: view.contentDOM, lineNumber: line.number,
          onToggleBookmark: () => onToggleBookmark(line.from),
        });
      }}
      onContextMenu={event => {
        if (!sourceHandle) return;
        if (!(event.target instanceof Element) || !event.target.closest(".cm-editor")) return;
        event.preventDefault();
        event.stopPropagation();
        const view = sourceHandle.view;
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const current = view.state.selection.main;
        if (position !== null && (current.empty || position < current.from || position > current.to)) {
          view.dispatch({ selection: { anchor: position } });
        }
        setSourceContextMenu({ x: event.clientX, y: event.clientY, view, readonly: view.state.readOnly, trigger: view.contentDOM });
      }}
    >
      <div className="markdown-source-content">{children(controls)}</div>
      {!mobile && matchesPreview && !matchesOpen && matchesList}
      {!mobile && (
        <DesktopDocumentPanels
          controller={controller}
          bookmarkEmpty={bookmarks.length === 0}
          outline={renderPanel("outline")}
          bookmark={renderPanel("bookmark")}
          matches={matchesList}
          matchesOpen={matchesOpen && sourceWordEnabled}
        />
      )}
      {renamingBookmark && <BookmarkRenameDialog
        key={renamingBookmark.id}
        bookmark={renamingBookmark}
        onSave={label => { onRenameBookmark(renamingBookmark.id, label); setRenamingBookmark(null); }}
        onClose={() => setRenamingBookmark(null)}
      />}
      {sourceContextMenu && <SourceEditorContextMenu target={sourceContextMenu} close={closeSourceContextMenu} />}
    </section>
  );
}
