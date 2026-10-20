import { useDocumentActive } from "./RetainedDocument";
import { useNativeMenuActions } from "../hooks/useNativeMenuActions";
import { ToolbarIcon } from "./ToolbarIcon";
import { DocumentPanelTitle, OutlinePanelTitle } from "./OutlinePanelTitle";
import { PanelDisplayTools, revealPanelItem } from "./PanelDisplayTools";
import { panelDisplayStyle, bookmarkTooltip, sortedBookmarks } from "../lib/panel-display-view";
import type { CSSProperties } from "react";
import { usePanelDisplay } from "../hooks/usePanelDisplay";
import {
  useEffect,
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
import { extractCSourceSymbols } from "../lib/source-symbols";
import type { DocumentOutlineItem } from "../lib/document-outline";

type SourceOutlineItem = DocumentOutlineItem & { offset: number };

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
  sourceHandle,
  onJump,
  children,
}: {
  revision: SourceNavigationDocument;
  areaRef: RefObject<SourceEditorHandle>;
  sourceHandle: SourceEditorHandle | null;
  onJump: (offset: number) => void;
  children: (controls: ReactNode) => ReactNode;
}) {
  const documentActive = useDocumentActive();
  const mobile = useMobileViewport();
  const outlineDisplayConfig = usePanelDisplay("document-outline");
  const bookmarkDisplayConfig = usePanelDisplay("bookmarks");
  const bookmarkDisplayListRef = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState(revision);
  const [sourceSymbols, setSourceSymbols] = useState<SourceOutlineItem[]>([]);
  const [symbolsBusy, setSymbolsBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [folds, setFolds] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    // Coalesce typing and reuse the same lazy parse as autosave; no hidden rich editor.
    if (mobile) return;
    const timer = setTimeout(() => {
      setSnapshot(revision);
      setFolds(new Set());
    }, 160);
    return () => clearTimeout(timer);
  }, [revision, mobile]);
  useEffect(() => {
    if (mobile || snapshot.language !== "c") {
      setSourceSymbols([]);
      setSymbolsBusy(false);
      return;
    }
    const controller = new AbortController();
    setSourceSymbols([]);
    setSymbolsBusy(true);
    const timer = setTimeout(() => {
      void extractCSourceSymbols(snapshot.source, controller.signal)
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
  }, [snapshot, mobile]);
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
  const symbolOutline = snapshot.language === "c";
  const outline = useMemo<SourceOutlineItem[]>(
    () => mobile ? [] : symbolOutline ? sourceSymbols : snapshot.outline.map((item) => ({ ...item, kind: undefined })),
    [snapshot, mobile, sourceSymbols, symbolOutline],
  );
  const bookmarks = useMemo(
    () => (mobile ? [] : snapshot.bookmarks),
    [snapshot, mobile],
  );
  const nearestBookmark = bookmarks.reduce<(typeof bookmarks)[number] | undefined>((current, item) => !current || Math.abs(item.offset - offset) < Math.abs(current.offset - offset) ? item : current, undefined);
  const controller = useDesktopDocumentPanels(!mobile, outline, bookmarks);
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
          onPointerEnter={(event) => controller.enter(kind, event.pointerType)}
          onPointerLeave={controller.leave}
          onClick={() => controller.toggle(kind)}
        >
          <FocusModeIcon name={kind} />
        </button>
      ))}
    </>
  );
  const renderPanel = (kind: "outline" | "bookmark") => {
    if (!controller.pinned(kind) && controller.preview !== kind) return null;
    const isOutline = kind === "outline";
    return (
      <nav
        ref={isOutline ? outlinePanel : bookmarkPanel}
        className={
          isOutline ? "document-outline-panel" : "document-bookmark-panel"
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
              <OutlineDisplayTools listRef={listRef} targetLabel={symbolOutline ? "定位当前符号" : "定位当前标题"} />
              <button type="button" aria-label="全部折叠" title="折叠目录" onClick={() => setFolds(new Set(outline.filter((item, i) => outline[i + 1]?.level > item.level).map(item => item.pos)))}>−</button>
              <button type="button" aria-label="全部展开" title="展开目录" onClick={() => setFolds(new Set())}>+</button>
            </>}
          </div>
          <div className="document-outline-header-actions">
          {!isOutline && <PanelDisplayTools target="bookmarks" disabled={!nearestBookmark} handlers={{ "bookmarks.reveal-current": () => revealPanelItem(bookmarkDisplayListRef.current, nearestBookmark?.id) }} />}
          {isOutline && <div className="document-outline-jumps" aria-label="目录快速滚动">{(["top", "middle", "bottom"] as const).map((target, i) => <button type="button" key={target} title={["滚动至顶部", "滚动至中部", "滚动至底部"][i]} aria-label={["滚动至顶部", "滚动至中部", "滚动至底部"][i]} onClick={() => listRef.current?.dispatchEvent(new CustomEvent(OUTLINE_SCROLL_EVENT, { detail: target }))}>{<ToolbarIcon name={(["pageTop", "pageMiddle", "pageBottom"] as const)[i]} />}</button>)}</div>}
          {(isOutline ? outlineDisplayConfig?.showCounts !== false : bookmarkDisplayConfig?.showCounts !== false) && <span className={isOutline ? "document-outline-count" : "document-bookmark-count"}>
            {isOutline ? outline.length : bookmarks.length} 项
          </span>}
          {!controller.pinned(kind) && <button type="button" onClick={() => controller.toggle(kind)}>
            {controller.pinned(kind) ? "收起" : "固定"}
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
        ) : (
          <div className="document-bookmark-list" ref={bookmarkDisplayListRef} data-panel-display={bookmarkDisplayConfig ? "plugin" : undefined} style={panelDisplayStyle(bookmarkDisplayConfig) as CSSProperties}>
            {bookmarks.length ? (
              sortedBookmarks(bookmarks, bookmarkDisplayConfig).map((bookmark) => (
                <div key={bookmark.id} className={`document-bookmark-item${bookmarkDisplayConfig && nearestBookmark?.id === bookmark.id ? " is-current" : ""}`} data-bookmark-id={bookmark.id}>
                  <button
                    type="button"
                    className="document-bookmark-jump"
                    title={bookmarkTooltip(bookmark, bookmarkDisplayConfig)}
                    onClick={() => jump(bookmark.offset)}
                  >
                    {bookmarkDisplayConfig?.showMetadata !== false && <span className="document-bookmark-index">
                      {bookmark.blockNumber}
                    </span>}
                    <span>{bookmark.label || bookmark.preview}</span>
                  </button>
                </div>
              ))
            ) : (
              <div className="document-bookmark-empty">当前文档还没有书签</div>
            )}
          </div>
        )}
      </nav>
    );
  };
  return (
    <section
      className={`note-editor markdown-source-editor ${desktopPanelClass(controller, true)}`}
      style={desktopPanelStyle(controller)}
      aria-label="Markdown 源码编辑区"
    >
      <div className="markdown-source-content">{children(controls)}</div>
      {!mobile && (
        <DesktopDocumentPanels
          controller={controller}
          outline={renderPanel("outline")}
          bookmark={renderPanel("bookmark")}
        />
      )}
    </section>
  );
}
