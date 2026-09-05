import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Slice } from "@tiptap/pm/model";
import type { NoteEditorProps } from "./NoteEditor";
import { FocusModeBar, FocusModeIcon } from "./FocusModeBar";
import { DocumentPanelDrawer } from "./DocumentPanelDrawer";
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
import { editorGutterWidth } from "../lib/editor-gutter";
import { bindEdgeSwipe, isWithinSwipeEdge } from "../lib/edge-swipe";
import { isDocumentFindKeyEvent } from "../lib/shortcuts";

type BlockState = { collapsed?: boolean; wrap?: boolean };
// Reading overrides belong to a document revision, not a mounted block.
const sessions = new WeakMap<PMNode, Map<number, BlockState>>();
function readingSession(key: PMNode) {
  let session = sessions.get(key);
  if (!session) {
    session = new Map();
    sessions.set(key, session);
  }
  return session;
}

function renderBlock(
  node: PMNode,
  pos: number,
  states: Map<number, BlockState>,
  update: (pos: number, value: BlockState) => void,
  match: SearchMatch | undefined,
  defaultWrap: boolean,
): React.ReactNode {
  if (node.isText) {
    const text = node.text ?? "";
    const start = Math.max(0, (match?.from ?? Infinity) - pos);
    const end = Math.min(text.length, (match?.to ?? -1) - pos);
    let rendered: React.ReactNode =
      start < end ? (
        <>
          {text.slice(0, start)}
          <mark className="search-match search-match-active">
            {text.slice(start, end)}
          </mark>
          {text.slice(end)}
        </>
      ) : (
        text
      );
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
                color: mark.attrs.color || undefined,
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
          if (/^(https?:|mailto:|tel:)/i.test(href))
            rendered = (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {rendered}
              </a>
            );
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
        {renderBlock(
          child,
          pos + offset + 1,
          states,
          update,
          match,
          defaultWrap,
        )}
      </React.Fragment>,
    ),
  );
  const state = states.get(pos) ?? {};
  const attrs = { "data-indent": node.attrs.indent || undefined };
  switch (node.type.name) {
    case "hardBreak":
      return <br />;
    case "horizontalRule":
      return <hr />;
    case "paragraph":
      return <p {...attrs}>{children.length ? children : <br />}</p>;
    case "heading":
      return React.createElement(`h${node.attrs.level}`, attrs, children);
    case "bulletList":
      return <ul {...attrs}>{children}</ul>;
    case "orderedList":
      return (
        <ol
          {...attrs}
          start={node.attrs.start}
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
    case "listItem":
      return <li>{children}</li>;
    case "blockquote": {
      const collapsed = state.collapsed ?? node.attrs.collapsed === true;
      return (
        <blockquote
          {...attrs}
          className="blockquote-wrap"
          data-collapsed={String(collapsed)}
        >
          <div className="blockquote-toolbar" contentEditable={false}>
            <span>引用</span>
            <button
              type="button"
              aria-label={collapsed ? "展开引用块" : "折叠引用块"}
              aria-expanded={!collapsed}
              onClick={() => update(pos, { collapsed: !collapsed })}
            >
              {collapsed ? "▶" : "▼"}
            </button>
          </div>
          {!collapsed && <div className="blockquote-content">{children}</div>}
        </blockquote>
      );
    }
    case "codeBlock": {
      const collapsed = state.collapsed ?? node.attrs.collapsed === true;
      const wrap =
        state.wrap ??
        (node.attrs.wrap === undefined
          ? defaultWrap
          : node.attrs.wrap !== false);
      return (
        <div
          {...attrs}
          className={`code-block-wrap ${collapsed ? "collapsed" : ""}`}
          data-code-wrap={String(wrap)}
        >
          <div className="vr-code-toolbar" contentEditable={false}>
            <span>{node.attrs.title || node.attrs.language || "代码"}</span>
            <button
              type="button"
              onClick={() => void copyToClipboard(node.textContent)}
            >
              复制代码
            </button>
            <button
              type="button"
              aria-pressed={wrap}
              onClick={() => update(pos, { wrap: !wrap })}
            >
              换行
            </button>
            <button
              type="button"
              aria-label={collapsed ? "展开代码块" : "折叠代码块"}
              aria-expanded={!collapsed}
              onClick={() => update(pos, { collapsed: !collapsed })}
            >
              {collapsed ? "▶" : "▼"}
            </button>
          </div>
          {!collapsed && (
            <div className="code-block-inner">
              <pre>
                <code>{children}</code>
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
  props: NoteEditorProps & { doc: PMNode; onFallback: () => void },
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
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<number, number>());
  const pendingAnchor = useRef<ReadingAnchor | null>(null);
  const pendingMatch = useRef<SearchMatch | null>(null);
  const [revision, setRevision] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [folds, setFolds] = useState(
    () => new Set(sessionHeadingFoldStore.load(noteId)?.collapsedKeys ?? []),
  );
  const states = useMemo(() => readingSession(doc), [doc]);
  const sections = useMemo(() => extractHeadingSections(doc), [doc]);
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
  const [panel, setPanel] = useState<"outline" | "bookmarks" | "search" | null>(
    null,
  );
  const [presentation, setPresentation] = useState<"popover" | "drawer">(
    "popover",
  );
  const openPanel = useCallback((next: typeof panel, drawer = false) => {
    setPresentation(drawer ? "drawer" : "popover");
    setPanel(next);
  }, []);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const matches = useMemo(() => findSearchMatches(doc, query), [doc, query]);
  const activeMatch = matches[matchIndex];
  const [selectionWindow, setSelectionWindow] = useState<
    [number, number] | null
  >(null);
  const selectedBlocks = useRef<[number, number] | null>(null);
  const [notice, setNotice] = useState("");
  const scrollBusy = useRef(false);
  const touchDown = useRef(false);
  const savedAnchor = useRef<ReadingAnchor>({ position: 0, offset: 0 });
  const initialContentVersion = useRef(contentVersion);
  const anchorKey = `nr:readonlyAnchor:${noteId}`;
  const capture = useCallback((): ReadingAnchor => {
    const root = rootRef.current;
    const current = layoutRef.current;
    const index = current.atOffset(root?.scrollTop ?? 0);
    return {
      position: current.blocks[index]?.pos ?? 0,
      offset: (root?.scrollTop ?? 0) - current.offsets[index],
    };
  }, []);
  const preserve = useCallback(() => {
    pendingAnchor.current = capture();
  }, [capture]);
  useLayoutEffect(() => {
    preserve();
    heights.current.clear();
    setRevision((value) => value + 1);
  }, [
    props.editorFontSize,
    props.cjkLatinSpacing,
    props.showLineNumbers,
    preserve,
  ]);
  const jump = useCallback(
    (position: number, offset = 0, match?: SearchMatch) => {
      // Explicit navigation supersedes an earlier scroll-settle timer. Native
      // inertia tracking must not swallow search/bookmark/button requests.
      scrollBusy.current = false;
      pendingAnchor.current = { position, offset };
      pendingMatch.current = match ?? null;
      doc.descendants((node, pos) => {
        if (position < pos || position >= pos + node.nodeSize) return false;
        if (
          position > pos &&
          (node.type.name === "blockquote" || node.type.name === "codeBlock")
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
    [sections, doc, states],
  );
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
    sessionHeadingFoldStore.save(noteId, {
      version: 1,
      collapsedKeys: [...folds],
    });
  }, [noteId, folds]);
  useEffect(() => {
    onOutlineAvailabilityChange?.(sections.length > 0);
    onStickyTitleChange?.(null);
  }, [onOutlineAvailabilityChange, onStickyTitleChange, sections.length]);

  useLayoutEffect(() => {
    let initial = takeReadingAnchor(noteId);
    if (!initial) {
      try {
        const stored = JSON.parse(localStorage.getItem(anchorKey) ?? "null");
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
    if (initial) jump(initial.position, initial.offset);
  }, [anchorKey, jump, noteId]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (pendingAnchor.current && !scrollBusy.current) {
      const anchor = pendingAnchor.current;
      const index = layout.atPosition(anchor.position);
      root.scrollTop = Math.max(0, layout.offsets[index] + anchor.offset);
      pendingAnchor.current = null;
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
      const anchor = savedAnchor.current;
      try {
        localStorage.setItem(
          anchorKey,
          JSON.stringify({ ...anchor, version: contentVersion }),
        );
      } catch {
        /* best effort */
      }
    };
    const settle = () => {
      if (touchDown.current) return;
      scrollBusy.current = false;
      // User scrolling wins over a deferred geometry correction.
      pendingAnchor.current = null;
      savedAnchor.current = capture();
      persist();
    };
    const scroll = () => {
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
        preserve();
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
    window.addEventListener("pagehide", persist);
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
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", persist);
    };
  }, [anchorKey, contentVersion, capture, preserve]);

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
      for (const row of body.querySelectorAll<HTMLElement>(
        "[data-reading-row]",
      )) {
        const pos = Number(row.dataset.position);
        const height = row.getBoundingClientRect().height;
        if (
          height > 0 &&
          Math.abs((heights.current.get(pos) ?? -1) - height) > 0.5
        )
          changes.push([pos, height]);
      }
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
    const rect = mark.getBoundingClientRect();
    const offset = rect.top - row.getBoundingClientRect().top - 12;
    root.scrollTop += rect.top - root.getBoundingClientRect().top - 12;
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
  }, [start, end]);
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
    const found = findSearchMatches(doc, target.query);
    setQuery(target.query);
    setMatchIndex(0);
    openPanel("search");
    if (found[0]) jump(found[0].from, 0, found[0]);
    onSearchTargetConsumed?.(target.requestId);
  }, [searchTarget, onSearchTargetConsumed, doc, noteId, jump, openPanel]);
  useEffect(
    () =>
      bindEdgeSwipe(rootRef.current!, (touch) => {
        if (
          !props.focusMode ||
          !isWithinSwipeEdge(window.innerWidth - touch.clientX)
        )
          return null;
        return {
          direction: "left",
          run: () =>
            openPanel(
              touch.clientY < window.innerHeight / 2 ? "bookmarks" : "outline",
              true,
            ),
        };
      }),
    [props.focusMode, openPanel],
  );
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (isDocumentFindKeyEvent(event)) {
        event.preventDefault();
        event.stopPropagation();
        openPanel("search");
      }
      if (event.key === "Escape") setPanel(null);
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "a" &&
        bodyRef.current?.contains(document.activeElement)
      ) {
        event.preventDefault();
        setNotice("跨全文选择请使用“完整渲染”；“复制全文”不受局部渲染限制。");
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [openPanel]);
  const tap = useRef<{
    pos: number;
    time: number;
    x: number;
    y: number;
  } | null>(null);
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const bookmarks = props.content.metadata?.bookmarks ?? [];
  const toolbar = (
    <>
      <button
        type="button"
        title="目录"
        aria-label="目录"
        onClick={() => openPanel(panel === "outline" ? null : "outline")}
      >
        <FocusModeIcon name="outline" />
      </button>
      <button
        type="button"
        title="书签"
        aria-label="书签"
        onClick={() => openPanel(panel === "bookmarks" ? null : "bookmarks")}
      >
        <FocusModeIcon name="bookmark" />
      </button>
      <button
        type="button"
        title={props.focusMode ? "退出专注" : "专注模式"}
        aria-label={props.focusMode ? "退出专注" : "专注模式"}
        onClick={() => props.onFocusModeChange?.(!props.focusMode)}
      >
        <FocusModeIcon name="exit" />
      </button>
    </>
  );
  return (
    <div
      className={`note-editor note-editor-readonly vr-note ${props.cjkLatinSpacing ? "editor-auto-cjk-spacing" : ""} ${props.focusMode ? "focus-mode" : ""}`}
      data-virtual-reader="true"
      style={
        {
          "--editor-font-size": `${props.editorFontSize}px`,
          "--editor-gutter-width": `${editorGutterWidth(doc.childCount, props.showLineNumbers, true)}px`,
        } as React.CSSProperties
      }
    >
      {props.focusMode ? (
        <FocusModeBar title={props.title || "无标题"}>{toolbar}</FocusModeBar>
      ) : (
        <div className="vr-title">
          <button
            type="button"
            aria-label="设为可编辑"
            disabled={!props.onReadonlyChange}
            onClick={() => {
              handoffReadingAnchor(noteId, capture());
              void props.onReadonlyChange?.(false);
            }}
          >
            🔒
          </button>
          <strong>{props.title || "无标题"}</strong>
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
              clipboardSliceToPlainText(new Slice(doc.content, 0, 0)),
            )
          }
        >
          复制全文
        </button>
        <button type="button" onClick={fallback}>
          完整渲染
        </button>
      </div>
      {notice && (
        <div className="vr-notice" role="status">
          {notice}
          <button type="button" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      <DocumentPanelDrawer
        enabled
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
        {panel && (
          <section
            className="vr-panel"
            aria-label={
              panel === "outline"
                ? "文档目录"
                : panel === "bookmarks"
                  ? "文档书签"
                  : "文内搜索"
            }
          >
            <button
              type="button"
              className="vr-panel-close"
              aria-label="关闭阅读面板"
              onClick={() => setPanel(null)}
            >
              ×
            </button>
            {panel === "outline" && (
              <>
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
                {sections.map((section) => (
                  <div
                    className="vr-outline-row"
                    key={section.key}
                    style={{ paddingLeft: (section.level - 1) * 12 }}
                  >
                    <button
                      type="button"
                      aria-label={`折叠切换 ${section.text}`}
                      aria-expanded={!folds.has(section.key)}
                      disabled={section.end <= section.headingEnd}
                      onClick={() => toggleHeading(section.pos)}
                    >
                      {folds.has(section.key) ? "▶" : "▼"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        jump(section.pos);
                        setPanel(null);
                      }}
                    >
                      {section.text}
                    </button>
                  </div>
                ))}
              </>
            )}
            {panel === "bookmarks" && (
              <>
                <h3>书签</h3>
                {bookmarks.length === 0 && <p>暂无书签</p>}
                {bookmarks.map((bookmark) => (
                  <button
                    type="button"
                    className="vr-bookmark"
                    key={bookmark.id}
                    onClick={() => {
                      jump(bookmark.position);
                      setPanel(null);
                    }}
                  >
                    {bookmark.label || bookmark.preview || "书签"}
                  </button>
                ))}
                <button type="button" onClick={fallback}>
                  管理书签（完整渲染）
                </button>
              </>
            )}
            {panel === "search" && (
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
        )}
      </DocumentPanelDrawer>
      <div className="note-editor-scroll vr-scroll" ref={rootRef}>
        <div
          className="editor-content vr-body"
          ref={bodyRef}
          tabIndex={0}
          role="document"
          aria-label="只读正文"
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
            if (row && Date.now() - (tap.current?.time ?? 0) > 500)
              toggleHeading(Number(row.dataset.position));
          }}
          onPointerDown={(event) => {
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
          {blocks.slice(start, end).map((block) => {
            const section = sectionByPos.get(block.pos);
            return (
              <div
                className="vr-row"
                key={block.pos}
                data-reading-row
                data-position={block.pos}
                data-block-number={block.number}
              >
                <div className="vr-gutter" contentEditable={false}>
                  {section && section.end > section.headingEnd && (
                    <button
                      type="button"
                      aria-label={`折叠切换 ${section.text}`}
                      aria-expanded={!folds.has(section.key)}
                      onClick={() => toggleHeading(block.pos)}
                    >
                      {folds.has(section.key) ? "▶" : "▼"}
                    </button>
                  )}
                  {props.showLineNumbers && <span>{block.number}</span>}
                </div>
                <div className="ProseMirror vr-block" contentEditable={false}>
                  {renderBlock(
                    block.node,
                    block.pos,
                    states,
                    updateBlock,
                    activeMatch,
                    props.defaultCodeBlockWrap,
                  )}
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
      {props.showStatusBar && (
        <div className="vr-status">
          {doc.childCount} 块 · 已挂载 {end - start} 块
          {selectionWindow ? " · 正在保留选区" : ""}
        </div>
      )}
    </div>
  );
}
