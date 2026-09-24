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
import { DOMSerializer, Slice } from "@tiptap/pm/model";
import type { NoteEditorProps } from "./NoteEditor";
import { FocusModeBar, FocusModeIcon } from "./FocusModeBar";
import { ToolbarIcon } from "./ToolbarIcon";
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
import { editorGutterWidth } from "../lib/editor-gutter";
import { bindViewportEdgeSwipe, swipeViewport } from "../lib/edge-swipe";
import { useMobileViewport } from "../hooks/useEdgeDrawer";
import { isDocumentFindKeyEvent, isPrimaryShortcutModifier } from "../lib/shortcuts";
import { readingBlockSession, type ReadingBlockState as BlockState } from "../lib/reading-block-session";
import { patchReadingState, readReadingState } from "../lib/reading-state";
import { centerSearchMatch } from "../lib/search-scroll";

function renderBlock(
  node: PMNode,
  pos: number,
  states: Map<number, BlockState>,
  update: (pos: number, value: BlockState) => void,
  match: SearchMatch | undefined,
  defaultWrap: boolean,
  followsList = false,
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
  const attrs = { "data-indent": node.attrs.indent || undefined, "data-list-followup": followsList || undefined };
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
      return <li data-task-checked={typeof node.attrs.taskChecked === "boolean" ? String(node.attrs.taskChecked) : undefined}>{children}</li>;
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
            <button type="button" className="block-workspace-open" data-workspace-position={pos} title="放大阅读引用块" aria-label="放大阅读引用块"><ToolbarIcon name="expand" /></button>
            <button
              type="button"
              aria-label={collapsed ? "展开引用块" : "折叠引用块"}
              aria-expanded={!collapsed}
              onClick={() => update(pos, { collapsed: !collapsed })}
            >
              <EditorFoldIcon expanded={!collapsed} />
            </button>
          </div>
          {!collapsed && <div className="blockquote-content">{children}</div>}
        </blockquote>
      );
    }
    case "codeBlock": {
      const collapsed = state.collapsed ?? node.attrs.collapsed === true;
      const lineNumbers = codeLineNumbersEnabled();
      const lines = node.textContent.split("\n");
      let linePosition = pos + 1;
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
            <span>{node.attrs.title || "代码"}</span>
            <span aria-label="代码语言">{CODE_LANGUAGE_OPTIONS.find(option => option.value === (normalizeCodeLanguage(node.attrs.language) ?? ""))?.label}</span>
            <button type="button" aria-label={lineNumbers ? "隐藏代码行号" : "显示代码行号"} aria-pressed={lineNumbers} onClick={() => saveBlockWorkspacePreferences({ lineNumbers: !lineNumbers })}>行号</button>
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
            <button type="button" className="block-workspace-open" data-workspace-position={pos} title="放大阅读代码块" aria-label="放大阅读代码块"><ToolbarIcon name="expand" /></button>
            <button
              type="button"
              aria-label={collapsed ? "展开代码块" : "折叠代码块"}
              aria-expanded={!collapsed}
              onClick={() => update(pos, { collapsed: !collapsed })}
            >
              <EditorFoldIcon expanded={!collapsed} />
            </button>
          </div>
          {!collapsed && (
            <div className="code-block-inner">
              <pre>
                <code>{lineNumbers ? lines.map((line, index) => {
                  const position = linePosition;
                  linePosition += line.length + 1;
                  return <span className="vr-code-line" key={index} style={{ gridTemplateColumns: `calc(${String(lines.length).length}ch + var(--code-line-number-padding, 8px)) minmax(0, 1fr)` }}>
                    <span className="vr-code-line-number" aria-hidden="true">{index + 1}</span>
                    <span>{line ? renderBlock(node.type.schema.text(line), position, states, update, match, defaultWrap) : "\n"}</span>
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
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<number, number>());
  const pendingAnchor = useRef<ReadingAnchor | null>(null);
  const pendingMatch = useRef<SearchMatch | null>(null);
  const pendingBookmark = useRef<number | null>(null);
  const [revision, setRevision] = useState(0);
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
  const states = useMemo(() => props.sensitive ? new Map<number, BlockState>() : readingBlockSession(noteId, contentVersion), [noteId, contentVersion, props.sensitive]);
  const sections = useMemo(() => extractHeadingSections(doc), [doc]);
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
  const desktopPanels = useDesktopDocumentPanels(!mobileDrawerViewport, sections, props.content.metadata?.bookmarks);
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
  const matches = useMemo(() => findSearchMatches(doc, query), [doc, query]);
  const activeMatch = matches[matchIndex];
  const [selectionWindow, setSelectionWindow] = useState<
    [number, number] | null
  >(null);
  const selectedBlocks = useRef<[number, number] | null>(null);
  const copyPosition = useRef<number | null>(null);
  const [notice, setNotice] = useState("");
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
      useNavigationStore.getState().record({ noteId, from: position, to: position }, true);
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
    [sections, doc, states, noteId],
  );
  const navigationTarget = useNavigationStore(state => state.target?.noteId === noteId ? state.target : null);
  useEffect(() => {
    const history = useNavigationStore.getState();
    history.activate(noteId);
    const position = capture().position;
    history.record({ noteId, from: position, to: position });
  }, [noteId, capture]);
  useEffect(() => {
    if (!navigationTarget) return;
    jump(Math.max(0, Math.min(navigationTarget.from, doc.content.size)));
    useNavigationStore.getState().consumed(navigationTarget.requestId);
  }, [navigationTarget, jump, doc]);
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
    if (initial) jump(initial.position, initial.offset);
  }, [anchorKey, jump, noteId, props.sensitive]);

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
    const settle = () => {
      if (touchDown.current) return;
      scrollBusy.current = false;
      // User scrolling wins over a deferred geometry correction.
      pendingAnchor.current = null;
      savedAnchor.current = capture();
      persist();
    };
    const scroll = () => {
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
    const position = pendingBookmark.current;
    const root = rootRef.current;
    if (position === null || !root) return;
    const block = layout.blocks[layout.atPosition(position)];
    const row = block && bodyRef.current?.querySelector<HTMLElement>(`[data-reading-row][data-position="${block.pos}"]`);
    if (!row) return;
    // Estimated heights can shift during mounting. Refine the explicit bookmark
    // destination once its real row is available, then preserve that viewport.
    const rowRect = row.getBoundingClientRect();
    const previousTop = root.scrollTop;
    centerSearchMatch(root, rowRect);
    const offset = root.scrollTop - previousTop + root.getBoundingClientRect().top - rowRect.top;
    pendingAnchor.current = { position: block.pos, offset };
    savedAnchor.current = pendingAnchor.current;
    pendingBookmark.current = null;
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
    if (target.bookmarkId) {
      const bookmark = props.content.metadata?.bookmarks?.find(item => item.id === target.bookmarkId);
      if (bookmark) {
        pendingBookmark.current = bookmark.position;
        jump(bookmark.position);
      }
      onSearchTargetConsumed?.(target.requestId);
      return;
    }
    const found = findSearchMatches(doc, target.query);
    setQuery(target.query);
    setMatchIndex(0);
    openPanel("search");
    if (found[0]) jump(found[0].from, 0, found[0]);
    onSearchTargetConsumed?.(target.requestId);
  }, [searchTarget, onSearchTargetConsumed, doc, noteId, jump, openPanel, props.content.metadata?.bookmarks]);

  const outlineTriggerRef = useRef<HTMLButtonElement>(null);
  const bookmarkTriggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const preview = mobileDrawerViewport ? panel : desktopPanels.preview === "bookmark" ? "bookmarks" : desktopPanels.preview;
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
        if (!mobileDrawerViewport) return null;
        const viewport = swipeViewport();
        if (touch.clientY >= viewport.middleY) return onOpenSettings ?? null;
        const target = lastMobilePanel.current;
        if (target === "outline" && sections.length === 0) return () => openPanel("bookmarks", true);
        return () => openPanel(target, true);
      }),
    [mobileDrawerViewport, sections.length, openPanel, onOpenSettings],
  );
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (rootRef.current?.closest("[inert]")) return;
      if (isDocumentFindKeyEvent(event)) {
        event.preventDefault();
        event.stopPropagation();
        openPanel("search");
      }
      if (event.key === "Escape") setPanel(null);
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
  }, [openPanel, capture, noteId, onFallback]);
  const tap = useRef<{
    pos: number;
    time: number;
    x: number;
    y: number;
  } | null>(null);
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const bookmarks = props.content.metadata?.bookmarks ?? [];
  const { onBookmarkCountChange } = props;
  useEffect(() => { onBookmarkCountChange?.(bookmarks.length); }, [onBookmarkCountChange, bookmarks.length]);
  useEffect(() => () => onBookmarkCountChange?.(0), [onBookmarkCountChange]);
  const toolbar = (
    <>
      <button type="button" title="复制块" aria-label="复制块" onMouseDown={(event) => event.preventDefault()} onClick={async () => {
        const pos = copyPosition.current ?? capture().position;
        const node = doc.nodeAt(pos);
        if (!node) return;
        const slice = doc.slice(pos, pos + node.nodeSize);
        const text = clipboardSliceToPlainText(slice);
        try {
          const container = document.createElement("div");
          container.append(DOMSerializer.fromSchema(doc.type.schema).serializeFragment(slice.content));
          await navigator.clipboard.write([new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([container.innerHTML], { type: "text/html" }),
          })]);
          setNotice("已复制当前块（保留格式）");
        } catch {
          try { await copyToClipboard(text, { reportFailure: true }); setNotice("已复制当前块（纯文本）"); }
          catch { setNotice("复制块失败，请检查剪贴板权限后重试"); }
        }
      }}><ToolbarIcon name="copy" /></button>
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
        title="文档书签"
        aria-label="文档书签"
        aria-expanded={mobileDrawerViewport ? panel === "bookmarks" : desktopPanels.pinned("bookmark") || preview === "bookmarks"}
        data-document-panel-trigger="bookmark" data-pinned={desktopPanels.pinned("bookmark")}
        onPointerEnter={event => desktopPanels.enter("bookmark", event.pointerType)} onPointerLeave={desktopPanels.leave}
        onClick={() => mobileDrawerViewport ? openPanel(panel === "bookmarks" ? null : "bookmarks") : togglePinnedPanel("bookmark")}
      >
        <FocusModeIcon name="bookmark" />
        {bookmarks.length > 0 && <span className="focus-bookmark-count" aria-hidden="true">{bookmarks.length > 99 ? "99+" : bookmarks.length}</span>}
      </button>
      <NavigationButtons />
      <button
        type="button"
        title={props.focusMode ? "退出专注模式" : "专注模式"}
        aria-label={props.focusMode ? "退出专注模式" : "专注模式"}
        onClick={() => props.onFocusModeChange?.(!props.focusMode)}
      >
        <ToolbarIcon name={props.focusMode ? "compress" : "expand"} />
      </button>
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
            <button
              type="button"
              className="vr-panel-close"
              aria-label="关闭阅读面板"
              onClick={() => {
                if (!mobileDrawerViewport && kind !== "search" && desktopPanels.pinned(kind === "outline" ? "outline" : "bookmark")) togglePinnedPanel(kind === "outline" ? "outline" : "bookmark");
                else { setPanel(null); dismissPreview(); }
              }}
            >
              ×
            </button>
            {!mobileDrawerViewport && kind !== "search" && !desktopPanels.pinned(kind === "outline" ? "outline" : "bookmark") && <button type="button" onClick={() => togglePinnedPanel(kind === "outline" ? "outline" : "bookmark")}>固定{kind === "outline" ? "目录" : "书签"}</button>}
            {kind === "outline" && (
              <>
                {!mobileDrawerViewport && <h3>目录</h3>}
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
                    title={section.text}
                    style={{ paddingLeft: (section.level - 1) * 12 }}
                  >
                    {section.end > section.headingEnd ? <button
                      type="button"
                      aria-label={`折叠切换 ${section.text}`}
                      aria-expanded={!folds.has(section.key)}
                      onClick={() => toggleHeading(section.pos)}
                    >
                      <EditorFoldIcon expanded={!folds.has(section.key)} />
                    </button> : <span className="vr-outline-fold-placeholder" aria-hidden="true" />}
                    <button
                      type="button"
                      data-drawer-swipe-item
                      onClick={() => {
                        jump(section.pos);
                        setPanel(null); dismissPreview();
                      }}
                    >
                      {section.text}
                    </button>
                  </div>
                ))}
              </>
            )}
            {kind === "bookmarks" && (
              <>
                <h3>书签</h3>
                {bookmarks.length === 0 && <p>暂无书签</p>}
                {bookmarks.map((bookmark) => (
                  <button
                    type="button"
                    className="vr-bookmark"
                    title={bookmark.label ? `${bookmark.label}\n${bookmark.preview}` : bookmark.preview}
                    data-drawer-swipe-item
                    key={bookmark.id}
                    onClick={() => {
                      jump(bookmark.position);
                      setPanel(null); dismissPreview();
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
  return (
    <div
      className={`note-editor note-editor-readonly vr-note ${desktopPanelClass(desktopPanels, sections.length > 0)} ${props.cjkLatinSpacing ? "editor-auto-cjk-spacing" : ""} ${props.focusMode ? "focus-mode" : ""}`}
      data-virtual-reader="true"
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
          <button type="button" className="focus-readonly-toggle" aria-label="点击设为可编辑"
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
            aria-label="设为可编辑"
            disabled={!props.onReadonlyChange}
            onClick={() => {
              handoffReadingAnchor(noteId, capture());
              void props.onReadonlyChange?.(false);
            }}
          >
            <ToolbarIcon name="lock" />
          </button>
          {props.mobileTitleBar ? <DocumentTitlePreview key={noteId} title={props.title || "无标题"} className={props.saveIssue ? `note-title-save-${props.saveIssue}` : ""} /> : props.unifiedTitleBar && props.focusMode ? <button type="button" className={`vr-properties-title${props.saveIssue ? ` note-title-save-${props.saveIssue}` : ""}`} aria-label="文档属性" onClick={props.onOpenProperties}>{props.title || "无标题"}</button> : <strong className={props.saveIssue ? `note-title-save-${props.saveIssue}` : undefined}>{props.title || "无标题"}</strong>}
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
      {notice && (notice.startsWith("已复制") || notice.startsWith("复制块失败") ?
        <CopyBlockNotice message={notice} onClose={() => setNotice("")} /> :
        <div className="vr-notice" role="status">
          {notice}
          <button type="button" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
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
        <DesktopDocumentPanels controller={desktopPanels}
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
            const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-reading-row]") : null;
            if (row) copyPosition.current = Number(row.dataset.position);
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
                      <EditorFoldIcon expanded={!folds.has(section.key)} />
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
                    followupBlocks.has(block.pos),
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
