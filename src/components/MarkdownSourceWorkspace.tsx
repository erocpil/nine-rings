import { OutlineJumpControls, SourceSymbolSearch, SourceSymbolTools } from "./DocumentNavigationTools";
import { SourceWordMatchList } from "./SourceWordMatchList";
import { useSourceWordMatches } from "../hooks/useSourceWordMatches";
import { sourceOutlineItems, outlineVisibleEntries, type SourceOutlineItem } from "../lib/source-navigation-view";
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
} from "react";
import type { SourceEditorHandle } from "../lib/source-editor-handle";
import { useMobileViewport } from "../hooks/useEdgeDrawer";
import { useDesktopDocumentPanels } from "../hooks/useDesktopDocumentPanels";
import { useDocumentPanelPosition } from "../hooks/useDocumentPanelPosition";
import {
  SourceNavigationDocument,
  sourceEditMapping,
} from "../lib/markdown-source-navigation";
import {
  DesktopDocumentPanels,
  desktopPanelClass,
  desktopPanelStyle,
} from "./DesktopDocumentPanels";
import { DocumentOutlineList, OutlineDisplayTools } from "./DocumentOutlineList";
import { FocusModeIcon } from "./FocusModeBar";
import { DocumentBookmarkRow } from "./DocumentBookmarkRow";
import { BookmarkRenameDialog } from "./BookmarkRenameDialog";
import {
  extractSourceSymbols,
  hasSourceSymbolProvider,
} from "../lib/source-symbol-provider";
import { focusSourceWordMatch } from "../lib/source-word-occurrences";
import type { DocumentBookmark } from "../types/models";
import {
  filterSymbolTree,
  sortSourceSymbolTree,
} from "../lib/source-symbol-sort";

export function MarkdownSourceWorkspace({
  revision,
  sourceHandle,
  onJump,
  onToggleBookmark,
  onRemoveBookmark,
  onRenameBookmark,
  children,
}: {
  revision: SourceNavigationDocument;
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
  const [sourceSymbolsSource, setSourceSymbolsSource] = useState<string | null>(null);
  const [symbolsBusy, setSymbolsBusy] = useState(false);
  const [symbolsAlphabetical, setSymbolsAlphabetical] = useState(false);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const [symbolQuery, setSymbolQuery] = useState("");
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
    if (mobile || !hasSourceSymbolProvider(snapshotLanguage)) {
      setSourceSymbols([]);
      setSourceSymbolsSource(null);
      setSymbolsBusy(false);
      return;
    }
    // RetainedDocument keeps a separate mounted editor tree per document. Leave
    // its last completed parse in place while parked, then refresh it when that
    // same document becomes active again.
    if (!documentActive) {
      setSymbolsBusy(false);
      return;
    }
    if (sourceSymbolsSource === snapshotSource) {
      setSymbolsBusy(false);
      return;
    }
    const controller = new AbortController();
    setSymbolsBusy(true);
    const timer = setTimeout(() => {
      void extractSourceSymbols(snapshotLanguage, snapshotSource, controller.signal)
        .then((symbols) => {
          if (!controller.signal.aborted && symbols) {
            setSourceSymbols(sourceOutlineItems(symbols));
            setSourceSymbolsSource(snapshotSource);
          }
        })
        .catch(() => {
          // Keep the last complete outline visible while a subsequent parse retries.
        })
        .finally(() => {
          if (!controller.signal.aborted) setSymbolsBusy(false);
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [snapshotSource, snapshotLanguage, sourceSymbolsSource, mobile, documentActive]);
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
  const scrollSourceTo = useCallback((target: "top" | "middle" | "bottom") => {
    const scroller = sourceHandle?.view.scrollDOM;
    if (!scroller) return;
    const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTo({ top: target === "top" ? 0 : target === "middle" ? maximum / 2 : maximum, behavior: "auto" });
  }, [sourceHandle]);
  useEffect(() => {
    if (matchesOpen || !documentActive || mobile || !sourceWordEnabled) {
      clearTimeout(matchesTimer.current);
      setMatchesPreview(false);
    }
  }, [matchesOpen, documentActive, mobile, sourceWordEnabled]);
  const symbolOutline = hasSourceSymbolProvider(snapshotLanguage);
  const sortedSourceSymbols = useMemo(
    () => sortSourceSymbolTree(sourceSymbols, symbolsAlphabetical),
    [sourceSymbols, symbolsAlphabetical],
  );
  const visibleSourceSymbols = useMemo(
    () => filterSymbolTree(sortedSourceSymbols, symbolQuery),
    [sortedSourceSymbols, symbolQuery],
  );
  const outline = useMemo<SourceOutlineItem[]>(
    () => mobile ? [] : symbolOutline ? visibleSourceSymbols : snapshot.outline.map((item) => ({ ...item, kind: undefined })),
    [snapshot, mobile, visibleSourceSymbols, symbolOutline],
  );
  const bookmarks = useMemo(() => (mobile ? [] : revision.bookmarks), [revision, mobile]);
  const nearestBookmark = bookmarks.reduce<(typeof bookmarks)[number] | undefined>((current, item) => !current || Math.abs(item.offset - offset) < Math.abs(current.offset - offset) ? item : current, undefined);
  const currentSourceBlock = revision.blockAt(offset);
  const currentBookmark = bookmarks.find(bookmark => bookmark.position === (currentSourceBlock?.position ?? -2) + 1);
  const controller = useDesktopDocumentPanels(!mobile, outline, bookmarks, [], symbolOutline ? 35 : undefined);
  const dismissPanelPreview = controller.dismiss;
  const { state: wordState, groups: groupedWordMatches } = useSourceWordMatches(sourceHandle, documentActive && !mobile && sourceWordEnabled, from => {
    setOffset(from); setMatchesOpen(true); dismissPanelPreview();
  });
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
  const activeSymbol = symbolOutline && sourceSymbolsSource === snapshotSource
    ? sourceSymbols.reduce<SourceOutlineItem | null>(
      (current, item) => item.offset <= offset && (!current || item.offset > current.offset) ? item : current,
      null,
    )
    : null;
  const active = symbolOutline
    ? activeSymbol ? outline.indexOf(activeSymbol) : -1
    : outline.reduce(
      (index, item, i) => (item.offset <= offset ? i : index),
      -1,
    );
  const entries = useMemo(() => outlineVisibleEntries(outline, item => !symbolQuery.trim() && folds.has(item.pos)), [outline, folds, symbolQuery]);
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
    if (sourceSymbolsSource !== currentSource || snapshot.source !== currentSource) {
      // The outline parse is intentionally debounced. If the user clicks during
      // that short window, re-resolve the symbol against the latest buffer by
      // semantic identity, preferring the occurrence nearest the mapped offset.
      let resolved = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const parsedSource = liveSource();
        const approximateOffset = sourceEditMapping(snapshot.source, parsedSource)(item.offset);
        const latest = await extractSourceSymbols(snapshotLanguage, parsedSource);
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
        aria-busy={snapshot !== revision || (symbolOutline && symbolsBusy)}
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
            {isOutline && !symbolOutline && <>
              <OutlineDisplayTools listRef={listRef} target="document-outline" targetLabel="定位当前标题" />
              <button type="button" aria-label="全部折叠" title="折叠目录" onClick={() => setFolds(new Set(outline.filter((item, i) => outline[i + 1]?.level > item.level).map(item => item.pos)))}>−</button>
              <button type="button" aria-label="全部展开" title="展开目录" onClick={() => setFolds(new Set())}>+</button>
            </>}
          </div>
          <div className={`document-outline-header-actions${isOutline && symbolOutline ? " is-source-symbol-actions" : ""}`}>
            {isOutline && symbolOutline && <SourceSymbolTools listRef={listRef} searchOpen={symbolSearchOpen}
              onSearchToggle={() => { setSymbolSearchOpen(value => !value); if (symbolSearchOpen) setSymbolQuery(""); }}
              alphabetical={symbolsAlphabetical} onSortToggle={() => setSymbolsAlphabetical(value => !value)}
              onCollapse={() => setFolds(new Set(outline.filter((item, i) => outline[i + 1]?.level > item.level).map(item => item.pos)))} onExpand={() => setFolds(new Set())} />}
            {!isOutline && <>
              <PanelDisplayTools target="bookmarks" disabled={!nearestBookmark} handlers={{ "bookmarks.reveal-current": () => revealPanelItem(bookmarkDisplayListRef.current, nearestBookmark?.id) }} />
              {!currentBookmark && <button className="document-bookmark-add" type="button" onClick={() => onToggleBookmark(offset)} aria-label="添加当前位置书签">添加</button>}
            </>}
          {isOutline && !symbolOutline && <OutlineJumpControls listRef={listRef} onDocumentScroll={scrollSourceTo} />}
          {(isOutline ? (symbolOutline ? sourceSymbolDisplayConfig?.showCounts === true : outlineDisplayConfig?.showCounts !== false) : bookmarkDisplayConfig?.showCounts !== false) && <span className={isOutline ? "document-outline-count" : "document-bookmark-count"}>
            {isOutline ? outline.length : bookmarks.length} 项
          </span>}
          {!controller.pinned(kind) && <button type="button" className="btn-icon document-panel-pin-button" onClick={() => controller.toggle(kind)} aria-label={isOutline ? (symbolOutline ? "固定源码符号" : "固定目录") : "固定书签"} title={isOutline ? (symbolOutline ? "固定源码符号" : "固定目录") : "固定书签"}>
            <ToolbarIcon name="pin" />
          </button>}
          </div>
        </div>
        {isOutline && symbolOutline && symbolSearchOpen && <SourceSymbolSearch value={symbolQuery} onChange={setSymbolQuery} onClose={() => { setSymbolQuery(""); setSymbolSearchOpen(false); }} />}
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
            <SourceWordMatchList groups={groupedWordMatches} word={wordState?.word} activeFrom={wordState?.activeFrom} display={sourceMatchDisplayConfig} onJump={target => {
              if (!sourceHandle) return;
              focusSourceWordMatch(sourceHandle.view, target); sourceHandle.scrollToOffset(target.from, true); setOffset(target.from);
            }} />
          </nav>;
  return (
    <section
      className={`note-editor markdown-source-editor ${desktopPanelClass(controller, true, matchesOpen && sourceWordEnabled)}`}
      style={desktopPanelStyle(controller)}
      aria-label="Markdown 源码编辑区"
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
    </section>
  );
}
