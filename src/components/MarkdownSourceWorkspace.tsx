import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
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
import { DocumentOutlineList } from "./DocumentOutlineList";
import { FocusModeIcon } from "./FocusModeBar";

export function MarkdownSourceWorkspace({
  revision,
  areaRef,
  onJump,
  children,
}: {
  revision: SourceNavigationDocument;
  areaRef: RefObject<HTMLTextAreaElement>;
  onJump: (offset: number) => void;
  children: (controls: ReactNode) => ReactNode;
}) {
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const update = () => {
      const style = getComputedStyle(area);
      const tail = Math.max(0, area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.lineHeight));
      area.style.paddingBottom = `${tail}px`;
    };
    const observer = new ResizeObserver(update);
    observer.observe(area, { box: "border-box" });
    update();
    return () => { observer.disconnect(); area.style.removeProperty("padding-bottom"); };
  }, [areaRef]);
  const mobile = useMobileViewport();
  const [snapshot, setSnapshot] = useState(revision);
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
    const area = areaRef.current;
    if (!area || mobile) return;
    const sync = () => setOffset(area.selectionStart);
    area.addEventListener("select", sync);
    area.addEventListener("keyup", sync);
    area.addEventListener("click", sync);
    return () => {
      area.removeEventListener("select", sync);
      area.removeEventListener("keyup", sync);
      area.removeEventListener("click", sync);
    };
  }, [areaRef, mobile]);
  const outline = useMemo(
    () => (mobile ? [] : snapshot.outline),
    [snapshot, mobile],
  );
  const bookmarks = useMemo(
    () => (mobile ? [] : snapshot.bookmarks),
    [snapshot, mobile],
  );
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
  const controls = mobile ? null : (
    <>
      {(["outline", "bookmark"] as const).map((kind) => (
        <button
          key={kind}
          ref={kind === "outline" ? outlineTrigger : bookmarkTrigger}
          type="button"
          className="btn-icon"
          title={kind === "outline" ? "文档目录" : "文档书签"}
          aria-label={kind === "outline" ? "文档目录" : "文档书签"}
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
        aria-label={isOutline ? "文档目录" : "文档书签"}
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
          <span>{isOutline ? "目录" : "书签"}</span>
          <span className="document-outline-count">
            {isOutline ? outline.length : bookmarks.length} 项
          </span>
          <button type="button" onClick={() => controller.toggle(kind)}>
            {controller.pinned(kind) ? "收起" : "固定"}
          </button>
        </div>
        {isOutline ? (
          outline.length ? (
            <DocumentOutlineList
              entries={entries}
              activeOutlineIndex={active}
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
              onJump={(item) =>
                jump(
                  outline.find((heading) => heading.pos === item.pos)!.offset,
                )
              }
            />
          ) : (
            <div className="document-bookmark-empty">当前文档还没有标题</div>
          )
        ) : (
          <div className="document-bookmark-list">
            {bookmarks.length ? (
              bookmarks.map((bookmark) => (
                <div key={bookmark.id} className="document-bookmark-item">
                  <button
                    type="button"
                    className="document-bookmark-jump"
                    title={bookmark.label ? `${bookmark.label}\n${bookmark.preview}` : bookmark.preview}
                    onClick={() => jump(bookmark.offset)}
                  >
                    <span className="document-bookmark-index">
                      {bookmark.blockNumber}
                    </span>
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
