import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { ResizableImage } from "../extensions/ResizableImage";
import LinkExt from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { MarkdownLinkInput } from "../extensions/MarkdownLinkInput";
import {
  normalizePastedHTML,
  normalizeSingleParagraphHTML,
  normalizeSingleParagraphPaste,
} from "../extensions/NormalizeSingleParagraphPaste";
import CharacterCount from "@tiptap/extension-character-count";
import type { DeltaOps, DocumentBookmark, SearchNavigationTarget } from "../types/models";
import {
  proseMirrorToDelta,
  deltaToProseMirror,
  isProseMirror,
  isDelta,
} from "../lib/delta-converter";

// ── 自定义字体大小扩展 ──

import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { CellSelection, deleteCellSelection, TableMap } from "@tiptap/pm/tables";
import { addLog, toggleDebug } from "../lib/debugLog";
import { copyToClipboard } from "../lib/clipboard";
import {
  CodeBlockLineNumbers,
  setCodeBlockLineNumbersEnabled,
} from "../extensions/CodeBlockLineNumbers";
import { EditorBlockGutter } from "./EditorBlockGutter";
import { DocumentOutlineList, type VisibleOutlineEntry } from "./DocumentOutlineList";
import { MobileActionSheet } from "./MobileActionSheet";
import { storeImage } from "../lib/storage/db-images";
import { api } from "../lib/api";
import { looksLikeMarkdown, mdToDelta } from "../lib/md-parser";
import {
  SearchHighlights,
  findSearchMatches,
  searchMatchIndexFromPosition,
  setSearchHighlights,
  type SearchMatch,
} from "../extensions/SearchHighlights";
import { noteToMarkdown } from "../lib/markdown-serializer";
import { exportMarkdownWithDialog, isTauri } from "../lib/tauri-desktop";
import { exportDocumentAsPdf, type PdfDocumentInfo } from "../lib/pdf-export";
import { FULLSCREEN_WILL_CHANGE_EVENT } from "../lib/fullscreen";
import { editorGutterWidth } from "../lib/editor-gutter";
import { clipboardSliceToPlainText } from "../lib/clipboard-plain-text";
import { exitCurrentStructuredBlock, StructuredBlockExit } from "../extensions/StructuredBlockExit";
import {
  CjkLatinSpacing,
  setCjkLatinSpacing,
  supportsNativeCjkLatinSpacing,
} from "../extensions/CjkLatinSpacing";
import { isDocumentFindKeyEvent, isEditorLineJumpKeyEvent } from "../lib/shortcuts";
import {
  documentOutlineIndexAtPosition,
  extractDocumentOutline,
  type DocumentOutlineItem,
} from "../lib/document-outline";
import {
  getVimEditorMode,
  setVimModeEnabled,
  VimMode,
  type VimEditorMode,
} from "../extensions/VimMode";
import {
  HeadingFold,
  expandHeadingFoldsAt,
  getCollapsedHeadingKeys,
  setAllHeadingFolds,
  toggleHeadingSectionFold,
} from "../extensions/HeadingFold";
import {
  collapsedHeadingKeysForAll,
  extractHeadingSections,
  headingSectionAtPosition,
  sessionHeadingFoldStore,
  visibleHeadingSections,
  type HeadingSection,
} from "../lib/heading-fold";
import { BlockIndent } from "../extensions/BlockIndent";
import { StandaloneStrongLabel } from "../extensions/StandaloneStrongLabel";
import { cacheEditorDocument, getCachedEditorDocument } from "../lib/editor-session-cache";
import {
  DocumentBookmarks,
  removeBookmark,
  renameBookmark,
  toggleBookmark,
} from "../extensions/DocumentBookmarks";

const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => el.style.fontSize?.replace("px", "") || null,
            renderHTML: (attrs) => {
              if (!attrs.fontSize) return {};
              return { style: `font-size: ${attrs.fontSize}px` };
            },
          },
        },
      },
    ];
  },
  // @ts-expect-error TipTap custom extension commands
  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }: { chain: any }) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }: { chain: any }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

const AlignedTableCell = TableCell.extend({
  content: "paragraph",
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: (element) => element.style.textAlign || null,
        renderHTML: (attributes) => attributes.textAlign
          ? { style: `text-align: ${attributes.textAlign}` }
          : {},
      },
    };
  },
});

const AlignedTableHeader = TableHeader.extend({
  content: "paragraph",
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: (element) => element.style.textAlign || null,
        renderHTML: (attributes) => attributes.textAlign
          ? { style: `text-align: ${attributes.textAlign}` }
          : {},
      },
    };
  },
});

// ── 高亮当前行扩展 ──

const ActiveLinePlugin = Extension.create({
  name: "activeLinePlugin",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("activeLine"),
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr) {
            const { selection } = tr;
            if (!selection || !selection.$from) return DecorationSet.empty;
            if (selection.$from.depth === 0) return DecorationSet.empty;
            const start = selection.$from.before(1);
            const end = selection.$from.after(1);
            if (start >= end) return DecorationSet.empty;
            return DecorationSet.create(tr.doc, [
              Decoration.node(start, end, { class: "ProseMirror-activeline" }),
            ]);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

// ── 预设颜色 ──

const PRESET_COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc",
  "#d91e18", "#e67e23", "#feea3a", "#8ec63f", "#22a577", "#3daee9",
  "#7030a0", "#ffffff",
];

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32];

const VIM_MODE_LABELS: Record<VimEditorMode, string> = {
  normal: "NORMAL",
  insert: "INSERT",
  visual: "VISUAL",
  "visual-line": "V-LINE",
};
const OUTLINE_DOCK_KEY = "nr:documentOutlineDock";
const OUTLINE_WIDTH_KEY = "nr:documentOutlineWidth";
const DEFAULT_OUTLINE_DOCK_WIDTH = 280;
const OUTLINE_DOCK_MIN_WIDTH = 220;
const OUTLINE_DOCK_MAX_WIDTH = 560;

function getSavedOutlineDock(): "floating" | "left" | "right" {
  const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(OUTLINE_DOCK_KEY);
  return saved === "left" || saved === "right" ? saved : "floating";
}

function getSavedOutlineDockWidth(): number {
  const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(OUTLINE_WIDTH_KEY);
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed)
    ? Math.min(OUTLINE_DOCK_MAX_WIDTH, Math.max(OUTLINE_DOCK_MIN_WIDTH, parsed))
    : DEFAULT_OUTLINE_DOCK_WIDTH;
}

function clampOutlineDockWidth(width: number): number {
  return Math.min(OUTLINE_DOCK_MAX_WIDTH, Math.max(OUTLINE_DOCK_MIN_WIDTH, Math.round(width)));
}

// ══════════════════════════════════════

interface NoteEditorProps {
  noteId: string;
  title: string | null;
  content: DeltaOps;
  contentVersion?: string;
  pdfDocumentInfo?: PdfDocumentInfo;
  pdfExportRequestId?: number;
  tags: string[];
  readonly?: boolean;
  onReadonlyChange?: (readonly: boolean) => Promise<void> | void;
  focusMode: boolean;
  showLineNumbers: boolean;
  showStatusBlockNumber: boolean;
  showStatusBar: boolean;
  vimModeEnabled: boolean;
  highlightActiveLine: boolean;
  useCustomContextMenu: boolean;
  cjkLatinSpacing: boolean;
  editorFontSize: number;
  onEditorFontSizeChange: (size: number) => void;
  onTitleChange: (title: string) => void;
  onContentChange: (readContent: () => DeltaOps) => void;
  onTagsChange: (tags: string[]) => void;
  onVersionOpen?: () => void;
  onFocusModeChange?: (focus: boolean) => void;
  onStickyTitleChange?: (title: string | null) => void;
  onOutlineAvailabilityChange?: (available: boolean) => void;
  outlineRequestId?: number;
  saveStatus?: "clean" | "dirty" | "saving" | "saved" | "error";
  searchTarget?: SearchNavigationTarget | null;
  onSearchTargetConsumed?: (requestId: number) => void;
}

interface EditorViewportAnchor {
  position: number;
  offsetTop: number;
}

interface AllHeadingFoldRoundTrip {
  noteId: string;
  document: ProseMirrorNode;
  originalAnchor: EditorViewportAnchor;
  userMoved: boolean;
}

function editorReadingViewport(root: HTMLElement) {
  const rootRect = root.getBoundingClientRect();
  const sticky = root.querySelector<HTMLElement>(":scope > .note-editor-sticky");
  const stickyRect = sticky?.getBoundingClientRect();
  const stickyBottom = sticky
    && getComputedStyle(sticky).position === "sticky"
    && stickyRect
    && stickyRect.bottom > rootRect.top
    ? Math.min(rootRect.bottom, stickyRect.bottom)
    : rootRect.top;
  const top = Math.max(rootRect.top, stickyBottom);
  return { top, bottom: rootRect.bottom, height: Math.max(1, rootRect.bottom - top) };
}

/** 捕获正文视口顶部的顶层块及其像素偏移，不依赖易失效的 scrollTop 比例。 */
function captureEditorViewportAnchor(editor: Editor, root: HTMLElement): EditorViewportAnchor | null {
  if (editor.isDestroyed || !root.isConnected) return null;
  const viewport = editorReadingViewport(root);
  const editorRect = editor.view.dom.getBoundingClientRect();
  const probeX = Math.min(editorRect.right - 1, Math.max(editorRect.left + 1, editorRect.left + 48));
  for (const offset of [1, 8, 24, 48]) {
    const mapped = editor.view.posAtCoords({
      left: probeX,
      top: Math.min(viewport.bottom - 1, viewport.top + offset),
    })?.pos;
    if (mapped === undefined) continue;
    const safePosition = Math.max(0, Math.min(mapped, editor.state.doc.content.size));
    const $mapped = editor.state.doc.resolve(safePosition);
    const position = $mapped.depth >= 1 ? $mapped.before(1) : safePosition;
    const block = editor.view.nodeDOM(position);
    if (!(block instanceof HTMLElement)) continue;
    const rect = block.getBoundingClientRect();
    if (rect.height <= 0 || rect.bottom <= viewport.top + 0.5 || rect.top >= viewport.bottom) continue;
    return { position, offsetTop: rect.top - viewport.top };
  }
  return null;
}

/**
 * 在折叠布局中恢复块锚点。若原块被隐藏，则使用最外层已折叠标题作为
 * 临时锚点；全部展开时原始块会重新成为目标。
 */
function restoreEditorViewportAnchor(
  editor: Editor,
  root: HTMLElement,
  anchor: EditorViewportAnchor,
  sections: readonly HeadingSection[],
  collapsedKeys: ReadonlySet<string>,
): number | null {
  if (editor.isDestroyed || !root.isConnected) return null;
  let position = Math.max(0, Math.min(anchor.position, editor.state.doc.content.size));
  let block = editor.view.nodeDOM(position);
  let rect = block instanceof HTMLElement ? block.getBoundingClientRect() : null;
  if (!(block instanceof HTMLElement) || !rect || rect.height <= 0) {
    const foldedParent = sections.find((section) => (
      collapsedKeys.has(section.key)
      && position >= section.headingEnd
      && position < section.end
    ));
    if (!foldedParent) return null;
    position = foldedParent.pos;
    block = editor.view.nodeDOM(position);
    if (!(block instanceof HTMLElement)) return null;
    rect = block.getBoundingClientRect();
    if (rect.height <= 0) return null;
  }
  const viewport = editorReadingViewport(root);
  root.scrollTop += rect.top - viewport.top - anchor.offsetTop;
  return position;
}

// ── 模块级状态 ──
let _lastSaveLog = 0;

export function NoteEditor({ noteId, title, content, contentVersion = "", pdfDocumentInfo, pdfExportRequestId, focusMode, showLineNumbers, showStatusBlockNumber, showStatusBar, vimModeEnabled, highlightActiveLine, useCustomContextMenu, cjkLatinSpacing, editorFontSize, onEditorFontSizeChange, onTitleChange, onContentChange, tags, onTagsChange, readonly, onReadonlyChange, onVersionOpen, onFocusModeChange, onStickyTitleChange, onOutlineAvailabilityChange, outlineRequestId, saveStatus, searchTarget, onSearchTargetConsumed }: NoteEditorProps) {
  const titleRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const toolbarCellSelectionRef = useRef<CellSelection | null>(null);
  const toolbarInteractingRef = useRef(false);
  const documentMetadataRef = useRef(content.metadata);
  documentMetadataRef.current = content.metadata;
  const contentVersionRef = useRef(contentVersion);
  contentVersionRef.current = contentVersion;
  const searchMatchesRef = useRef<SearchMatch[]>([]);
  const editorFindOriginRef = useRef(0);
  const editorFindInputRef = useRef<HTMLInputElement>(null);
  const vimSearchActionRef = useRef<(direction: 1 | -1 | 0) => void>(() => undefined);
  const lineJumpInputRef = useRef<HTMLInputElement>(null);
  const outlineListRef = useRef<HTMLDivElement>(null);
  const bookmarksRef = useRef<DocumentBookmark[]>(content.metadata?.bookmarks ?? []);
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [activeSearchMatch, setActiveSearchMatch] = useState(0);
  const [editorFindOpen, setEditorFindOpen] = useState(false);
  const [editorFindQuery, setEditorFindQuery] = useState("");
  const [lineJumpOpen, setLineJumpOpen] = useState(false);
  const [lineJumpValue, setLineJumpValue] = useState("");
  const [lineJumpError, setLineJumpError] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(() => {
    const saved = getSavedOutlineDock();
    return saved === "left" || saved === "right";
  });
  const [outlineDock, setOutlineDock] = useState<"floating" | "left" | "right">(getSavedOutlineDock);
  const [outlineDockWidth, setOutlineDockWidth] = useState(getSavedOutlineDockWidth);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<DocumentBookmark[]>(bookmarksRef.current);
  const [activeOutlineIndex, setActiveOutlineIndex] = useState(-1);
  const [outlineOverflow, setOutlineOverflow] = useState(false);
  const [documentOutline, setDocumentOutline] = useState<DocumentOutlineItem[]>([]);
  const [outlineCollapsedHeadingKeys, setOutlineCollapsedHeadingKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [headingFoldRevision, setHeadingFoldRevision] = useState(0);
  const headingFoldRenderFrameRef = useRef<number | null>(null);
  const headingFoldViewportFrameRef = useRef<number | null>(null);
  const allHeadingFoldRoundTripRef = useRef<AllHeadingFoldRoundTrip | null>(null);
  const readonlyTouchPointerRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const readonlyLastTapRef = useRef<{
    time: number;
    x: number;
    y: number;
  } | null>(null);
  const outlineResizePointerIdRef = useRef<number | null>(null);
  const outlineResizeStartXRef = useRef(0);
  const outlineResizeStartWidthRef = useRef(DEFAULT_OUTLINE_DOCK_WIDTH);
  const outlineResizeCleanupRef = useRef<(() => void) | null>(null);
  const suppressReadonlyDoubleClickUntilRef = useRef(0);
  const lastOutlineRequestIdRef = useRef(outlineRequestId);
  const lastPdfExportRequestIdRef = useRef(pdfExportRequestId);
  const outlineBaseLevel = useMemo(
    () => documentOutline.length > 0
      ? Math.min(...documentOutline.map((item) => item.level))
      : 1,
    [documentOutline],
  );
  const [colorOpen, setColorOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [imageDialog, setImageDialog] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [tagInput, setTagInput] = useState("");
  const scrollPositionRef = useRef<HTMLSpanElement>(null);
  const [headingOpen, setHeadingOpen] = useState(false);
  // 受控标题：本地状态 + 从 prop 同步（支持外部重命名如 DocTree 右键改名）
  const [localTitle, setLocalTitle] = useState(title ?? "");
  const prevTitleRef = useRef(title);
  useEffect(() => {
    if (title !== prevTitleRef.current) {
      prevTitleRef.current = title;
      setLocalTitle(title ?? "");
    }
  }, [title]);
  const [headingPage, setHeadingPage] = useState(0); // 0=H3-5（默认）, 1=H1-2/6
  const [blockOpen, setBlockOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [clipOpen, setClipOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const [focusToolbarExpanded, setFocusToolbarExpanded] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  // 编辑器右键菜单 + 右键插入链接对话框
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [contextSubmenu, setContextSubmenu] = useState<"format" | "paragraph" | "insert" | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [linkDialog, setLinkDialog] = useState(false);
  const [linkDialogUrl, setLinkDialogUrl] = useState("");
  const [toolbarWidth, setToolbarWidth] = useState(1000);
  const [isMobileToolbarViewport, setIsMobileToolbarViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 768px)").matches;
  });
  const isNarrow = toolbarWidth < 900 || isMobileToolbarViewport;
  const isMinimalToolbar = toolbarWidth < 620 || isMobileToolbarViewport;
  const CODE_LN_KEY = "nr:codeLineNumbers";
  const [showCodeLineNumbers, setShowCodeLineNumbers] = useState(() => {
    return localStorage.getItem(CODE_LN_KEY) === "true";
  });
  const [markdownPasteText, setMarkdownPasteText] = useState<string | null>(null);
  const [markdownSelectionNotice, setMarkdownSelectionNotice] = useState(false);
  const [readonlyChangeNotice, setReadonlyChangeNotice] = useState(false);
  const [gutterBlockCount, setGutterBlockCount] = useState(0);
  const [currentStatusBlock, setCurrentStatusBlock] = useState(1);
  const [bookmarkCursorPosition, setBookmarkCursorPosition] = useState(1);
  const [selectedTableCellCount, setSelectedTableCellCount] = useState(0);
  const [, setEditorUiSignature] = useState("");
  const [vimEditorMode, setVimEditorMode] = useState<VimEditorMode>("normal");
  const [documentStats, setDocumentStats] = useState({ chars: 0, words: 0 });
  const documentStatsTimerRef = useRef<number | null>(null);
  const nativeCjkLatinSpacing = useMemo(supportsNativeCjkLatinSpacing, []);

  const scheduleDocumentStats = useCallback((target: Editor, immediate = false) => {
    if (!showStatusBar) return;
    if (documentStatsTimerRef.current !== null) {
      window.clearTimeout(documentStatsTimerRef.current);
    }
    documentStatsTimerRef.current = window.setTimeout(() => {
      documentStatsTimerRef.current = null;
      if (target.isDestroyed) return;
      setDocumentStats({
        chars: target.storage.characterCount?.characters?.() ?? 0,
        words: target.storage.characterCount?.words?.() ?? 0,
      });
    }, immediate ? 0 : 180);
  }, [showStatusBar]);

  useEffect(() => {
    if (!markdownPasteText) return;
    const timer = window.setTimeout(() => setMarkdownPasteText(null), 6000);
    return () => window.clearTimeout(timer);
  }, [markdownPasteText]);

  useEffect(() => {
    if (!markdownSelectionNotice) return;
    const timer = window.setTimeout(() => setMarkdownSelectionNotice(false), 4000);
    return () => window.clearTimeout(timer);
  }, [markdownSelectionNotice]);

  useEffect(() => {
    if (!readonlyChangeNotice) return;
    const timer = window.setTimeout(() => setReadonlyChangeNotice(false), 2400);
    return () => window.clearTimeout(timer);
  }, [readonlyChangeNotice]);

  // ── [[ 双向链接自动补全 ──
  const [wikiOpen, setWikiOpen] = useState(false);
  const [wikiSuggestions, setWikiSuggestions] = useState<{ title: string; id: string }[]>([]);
  const [wikiPos, setWikiPos] = useState({ top: 0, left: 0 });
  const wikiStartRef = useRef<number | null>(null); // [[ 在文档中的起始位置

  // 工具栏的可用空间取决于侧栏、属性面板和窗口宽度，不能使用 window
  // 作为断点来源。直接观察工具栏容器，布局变化时立即切换分组模式。
  useEffect(() => {
    const element = toolbarRef.current;
    if (!element) return;
    const updateWidth = () => setToolbarWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 768px)");
    const updateViewport = () => setIsMobileToolbarViewport(media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  // 点击外部关闭下拉框
  useEffect(() => {
    if (!sizeOpen && !colorOpen && !headingOpen && !blockOpen && !styleOpen && !clipOpen && !linkOpen && !tableOpen && !moreOpen && !outlineOpen && !bookmarkOpen) return;
    const handler = () => {
      setSizeOpen(false);
      setColorOpen(false);
      setHeadingOpen(false);
      setBlockOpen(false);
      setStyleOpen(false);
      setClipOpen(false);
      setLinkOpen(false);
      setTableOpen(false);
      setMoreOpen(false);
      setOutlineOpen(false);
      setBookmarkOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [sizeOpen, colorOpen, headingOpen, blockOpen, styleOpen, clipOpen, linkOpen, tableOpen, moreOpen, outlineOpen, bookmarkOpen]);

  // 关闭编辑器右键菜单（点击外部 / Escape / 滚动 / 失焦）
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => {
      setContextMenu(null);
      setContextSubmenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  // 菜单渲染后测量真实尺寸，clamp 到视口内（useLayoutEffect 在绘制前执行，无闪烁）
  useLayoutEffect(() => {
    if (!contextMenu) return;
    const el = contextMenuRef.current;
    if (!el) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
    const clampedX = Math.max(margin, Math.min(contextMenu.x, maxX));
    const clampedY = Math.max(margin, Math.min(contextMenu.y, maxY));
    if (clampedX !== contextMenu.x || clampedY !== contextMenu.y) {
      setContextMenu({ x: clampedX, y: clampedY });
    }
  }, [contextMenu, contextSubmenu]);

  // 观察标题是否可见，用于 sticky title（仅在专注模式）
  useEffect(() => {
    const el = titleRef.current;
    const root = scrollRef.current;
    if (!el || !onStickyTitleChange || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        // 非专注模式 never show sticky title
        if (!focusMode) {
          onStickyTitleChange(null);
          return;
        }
        onStickyTitleChange(entry.isIntersecting ? null : (title || "无标题"));
      },
      { threshold: 0, root }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [title, focusMode, onStickyTitleChange]);

  // 检测 content 格式并转换
  const tipTapContent = useMemo(() => {
    if (isProseMirror(content)) return content;
    if (isDelta(content)) {
      const cached = getCachedEditorDocument(noteId, contentVersion);
      if (cached) return cached;
      const converted = deltaToProseMirror(content);
      cacheEditorDocument(noteId, contentVersion, converted);
      return converted;
    }
    return content; // fallback
  }, [content, contentVersion, noteId]);

  const editor = useEditor({
    // ProseMirror 自己会局部更新正文 DOM。避免每次按键都重渲染整个
    // NoteEditor；工具栏上下文由下方的轻量签名按需驱动。
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: false,
      }),
      // 仅使用扩展的 is-editor-empty class 识别空段落；不在 gutter
      // 内显示文字，避免与行号和行间插入按钮争用伪元素。
      Placeholder.configure({ placeholder: "" }),
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      FontSize,
      ResizableImage.configure({ inline: false, allowBase64: true }),
      LinkExt.configure({ openOnClick: true }),
      Table.configure({
        resizable: true,
        handleWidth: 8,
        cellMinWidth: 48,
        lastColumnResizable: true,
        allowTableNodeSelection: true,
      }),
      TableRow,
      AlignedTableHeader,
      AlignedTableCell,
      // 仅用于统计，不限制文档长度。长 Markdown 粘贴（例如技术手册）
      // 可能超过 50,000 字符；设置 limit 会让 ProseMirror 拒绝整笔事务。
      CharacterCount.configure(),
      ActiveLinePlugin,
      SearchHighlights,
      CodeBlockLineNumbers.configure({ lineNumbersEnabled: showCodeLineNumbers }),
      StructuredBlockExit,
      MarkdownLinkInput,
      CjkLatinSpacing,
      BlockIndent,
      StandaloneStrongLabel,
      HeadingFold.configure({
        initialCollapsedKeys: sessionHeadingFoldStore.load(noteId)?.collapsedKeys ?? [],
        onChange: (collapsedKeys) => {
          sessionHeadingFoldStore.save(noteId, { version: 1, collapsedKeys });
          if (headingFoldRenderFrameRef.current === null) {
            headingFoldRenderFrameRef.current = window.requestAnimationFrame(() => {
              headingFoldRenderFrameRef.current = null;
              setHeadingFoldRevision((revision) => revision + 1);
            });
          }
        },
      }),
      DocumentBookmarks.configure({
        initialBookmarks: bookmarksRef.current,
        onChange: (nextBookmarks, docSnapshot) => {
          bookmarksRef.current = nextBookmarks;
          setBookmarks(nextBookmarks);
          const currentMetadata = documentMetadataRef.current ?? {};
          const metadata = nextBookmarks.length > 0
            ? { ...currentMetadata, bookmarks: nextBookmarks }
            : Object.fromEntries(Object.entries(currentMetadata).filter(([key]) => key !== "bookmarks"));
          documentMetadataRef.current = metadata;
          onContentChange(() => {
            const editorDocument = docSnapshot.toJSON();
            cacheEditorDocument(noteId, contentVersionRef.current, editorDocument);
            const delta = proseMirrorToDelta(editorDocument) as unknown as DeltaOps;
            return Object.keys(metadata).length > 0 ? { ...delta, metadata } : delta;
          });
        },
      }),
      VimMode.configure({
        enabled: vimModeEnabled,
        readOnly: Boolean(readonly),
        onModeChange: setVimEditorMode,
        onSearch: (direction) => vimSearchActionRef.current(direction),
      }),
    ],
    content: tipTapContent,
    editable: !readonly,
    onCreate: ({ editor: ed }) => scheduleDocumentStats(ed, true),
    editorProps: {
      attributes: { tabindex: "0" },
      transformPastedHTML: normalizePastedHTML,
      transformPasted: normalizeSingleParagraphPaste,
      clipboardTextSerializer: clipboardSliceToPlainText,
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      if (ed.isFocused && !toolbarInteractingRef.current) {
        toolbarCellSelectionRef.current = null;
        if (from === to) toolbarSelectionRef.current = null;
      }
      localStorage.setItem(`selectionPos:${noteId}`, JSON.stringify({ from, to }));
    },
    onUpdate: ({ editor: ed }) => {
      scheduleDocumentStats(ed);
      // 搜索高亮是导航提示，不应在用户开始修改正文后继续指向旧位置。
      if (searchMatchesRef.current.length > 0) {
        searchMatchesRef.current = [];
        setSearchMatches([]);
        setSearchHighlights(ed, [], 0);
      }
      // ProseMirror 节点是不可变快照。每次按键只登记一个轻量读取函数，
      // 等自动保存真正 flush 时才执行全文 JSON + Delta 转换，避免长文档
      // 在输入热路径上反复 O(N) 序列化。
      const docSnapshot = ed.state.doc;
      onContentChange(() => {
        const editorDocument = docSnapshot.toJSON();
        cacheEditorDocument(noteId, contentVersionRef.current, editorDocument);
        const delta = proseMirrorToDelta(editorDocument) as unknown as DeltaOps;
        const currentMetadata = documentMetadataRef.current ?? {};
        const metadata = bookmarksRef.current.length > 0
          ? { ...currentMetadata, bookmarks: bookmarksRef.current }
          : Object.fromEntries(Object.entries(currentMetadata).filter(([key]) => key !== "bookmarks"));
        return metadata ? { ...delta, metadata } : delta;
      });
      // 节流日志：每秒最多一次
      const now = Date.now();
      if (now - _lastSaveLog > 1000) {
        _lastSaveLog = now;
        addLog(`[变更] ${noteId.slice(0,8)} docSize=${ed.state.doc.content.size}`);
      }

      // ── [[ 双向链接检测 ──
      const { from } = ed.state.selection;
      const $from = ed.state.doc.resolve(from);
      const textBefore = $from.parent?.textContent?.slice(0, from - $from.start()) ?? "";
      const match = textBefore.match(/\[\[([^\]]*)$/);
      if (match && !readonly) {
        const query = match[1];
        wikiStartRef.current = from - query.length - 2; // [[ 位置
        // 获取光标位置用于定位下拉
        const view = ed.view;
        const coords = view.coordsAtPos(from);
        const editorEl = view.dom.closest(".note-editor-scroll") as HTMLElement;
        if (editorEl) {
          const er = editorEl.getBoundingClientRect();
          setWikiPos({ top: coords.bottom - er.top + 4, left: coords.left - er.left });
        }
        setWikiOpen(true);
        // 异步搜索匹配笔记
        api.notes.search(query || " ").then((notes) => {
          setWikiSuggestions(
            notes.map((n) => ({ title: n.title || "无标题", id: n.id }))
          );
        });
      } else {
        setWikiOpen(false);
        wikiStartRef.current = null;
      }
    },
  });

  useEffect(() => () => {
    if (headingFoldRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(headingFoldRenderFrameRef.current);
    }
    if (headingFoldViewportFrameRef.current !== null) {
      window.cancelAnimationFrame(headingFoldViewportFrameRef.current);
    }
    if (documentStatsTimerRef.current !== null) {
      window.clearTimeout(documentStatsTimerRef.current);
    }
  }, []);

  useEffect(() => {
    allHeadingFoldRoundTripRef.current = null;
    setOutlineCollapsedHeadingKeys(new Set());
    if (headingFoldViewportFrameRef.current !== null) {
      window.cancelAnimationFrame(headingFoldViewportFrameRef.current);
      headingFoldViewportFrameRef.current = null;
    }
  }, [noteId]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !editor) return;
    const markUserMove = () => {
      const roundTrip = allHeadingFoldRoundTripRef.current;
      if (
        roundTrip
        && roundTrip.noteId === noteId
        && roundTrip.document === editor.state.doc
      ) roundTrip.userMoved = true;
    };
    // 不监听 scroll：折叠布局自身也会产生可信的滚动夹取事件。只把实际
    // 输入视为用户改变阅读位置，避免将 WebKit 的自动 clamp 误判为手势。
    root.addEventListener("wheel", markUserMove, { passive: true });
    // 触摸滚动在连续 touchmove 前必定先 pointerdown；只监听起点，避免
    // 在移动端滚动热路径中增加逐帧 JavaScript 工作。
    root.addEventListener("pointerdown", markUserMove, { passive: true });
    root.addEventListener("keydown", markUserMove);
    return () => {
      root.removeEventListener("wheel", markUserMove);
      root.removeEventListener("pointerdown", markUserMove);
      root.removeEventListener("keydown", markUserMove);
    };
  }, [editor, noteId]);

  useEffect(() => {
    if (editor && showStatusBar) scheduleDocumentStats(editor, true);
  }, [editor, scheduleDocumentStats, showStatusBar]);

  // Mobile browsers resize the visual viewport after the keyboard animation. ProseMirror's
  // native selection scrolling can run before that resize and leave the caret underneath
  // the bottom edge (with or without the optional status bar), so correct it after both
  // selection and viewport/layout changes.
  useEffect(() => {
    if (!editor) return;
    let frame = 0;
    const revealCaret = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = scrollRef.current;
        if (!root || editor.isDestroyed || !editor.isFocused || readonly) return;
        try {
          const rootRect = root.getBoundingClientRect();
          const caret = editor.view.coordsAtPos(editor.state.selection.head);
          const visibleTop = rootRect.top + 16;
          const visibleBottom = rootRect.bottom - 24;
          if (caret.top < visibleTop) root.scrollTop -= visibleTop - caret.top;
          else if (caret.bottom > visibleBottom) root.scrollTop += caret.bottom - visibleBottom;
        } catch {
          // The view may be between transactions while the visual viewport is resizing.
        }
      });
    };
    const viewport = window.visualViewport;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(revealCaret);
    const scrollRoot = scrollRef.current;
    if (scrollRoot) observer?.observe(scrollRoot);
    editor.on("selectionUpdate", revealCaret);
    editor.on("focus", revealCaret);
    viewport?.addEventListener("resize", revealCaret);
    viewport?.addEventListener("scroll", revealCaret);
    window.addEventListener("resize", revealCaret);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      editor.off("selectionUpdate", revealCaret);
      editor.off("focus", revealCaret);
      viewport?.removeEventListener("resize", revealCaret);
      viewport?.removeEventListener("scroll", revealCaret);
      window.removeEventListener("resize", revealCaret);
    };
  }, [editor, readonly]);

  useEffect(() => {
    if (!editor) return;
    setCjkLatinSpacing(editor, cjkLatinSpacing && !nativeCjkLatinSpacing);
  }, [cjkLatinSpacing, editor, nativeCjkLatinSpacing]);

  useEffect(() => {
    if (!editor) return;
    setCodeBlockLineNumbersEnabled(editor, showCodeLineNumbers);
  }, [editor, showCodeLineNumbers]);

  useEffect(() => {
    if (!editor) return;
    setVimModeEnabled(editor, vimModeEnabled, Boolean(readonly));
  }, [editor, readonly, vimModeEnabled]);

  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      const total = editor.state.doc.childCount;
      const selected = editor.state.selection.$from.index(0) + 1;
      setCurrentStatusBlock(Math.max(1, Math.min(total, selected)));
      const { $head } = editor.state.selection;
      setBookmarkCursorPosition($head.depth > 0 && $head.parent.isTextblock ? $head.start() : $head.pos);
      let selectedCells = 0;
      if (editor.state.selection instanceof CellSelection) {
        editor.state.selection.forEachCell(() => { selectedCells++; });
      }
      setSelectedTableCellCount(selectedCells);
      const formattingState = [
        "bold", "italic", "strike", "link", "blockquote", "bulletList",
        "orderedList", "codeBlock", "table",
      ].map((name) => editor.isActive(name) ? "1" : "0").join("");
      const headingLevel = [1, 2, 3, 4, 5, 6]
        .find((level) => editor.isActive("heading", { level })) ?? 0;
      const textStyle = editor.getAttributes("textStyle");
      const selectionKind = editor.state.selection.empty
        ? "cursor"
        : `${editor.state.selection.from}:${editor.state.selection.to}`;
      setEditorUiSignature([
        formattingState,
        headingLevel,
        textStyle.fontSize ?? "",
        textStyle.color ?? "",
        selectionKind,
        editor.can().undo() ? "u1" : "u0",
        editor.can().redo() ? "r1" : "r0",
      ].join("|"));
    };
    refresh();
    editor.on("selectionUpdate", refresh);
    editor.on("update", refresh);
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("update", refresh);
    };
  }, [editor]);

  // Markdown 导入和手动标题最终都会成为 heading 节点，因此目录直接读取
  // 编辑器结构即可，并在正文变化时同步更新而无需改写文档内容。
  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      const next = extractDocumentOutline(editor.state.doc);
      setDocumentOutline((previous) => {
        const unchanged = previous.length === next.length
          && previous.every((item, index) => (
            item.level === next[index].level
            && item.text === next[index].text
            && item.pos === next[index].pos
          ));
        return unchanged ? previous : next;
      });
      if (next.length === 0) setOutlineOpen(false);
    };
    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      // 大文档的目录遍历是 O(N)。输入期间合并连续更新，避免每个按键都
      // 重新扫描整棵 ProseMirror 文档树，停顿后仍会及时刷新目录。
      refreshTimer = window.setTimeout(refresh, 160);
    };
    refresh();
    editor.on("update", scheduleRefresh);
    return () => {
      editor.off("update", scheduleRefresh);
      window.clearTimeout(refreshTimer);
    };
  }, [editor]);

  useEffect(() => {
    onOutlineAvailabilityChange?.(documentOutline.length > 0);
  }, [documentOutline.length, onOutlineAvailabilityChange]);

  useEffect(() => (
    () => onOutlineAvailabilityChange?.(false)
  ), [onOutlineAvailabilityChange]);

  const openDocumentOutline = useCallback(() => {
    if (!editor || editor.isDestroyed || documentOutline.length === 0) return;
    setActiveOutlineIndex(documentOutlineIndexAtPosition(
      documentOutline,
      editor.state.selection.from,
    ));
    setOutlineOverflow(false);
    setOutlineOpen(true);
  }, [documentOutline, editor]);

  const toggleDocumentOutline = useCallback(() => {
    if (outlineOpen) {
      setOutlineOpen(false);
      return;
    }
    openDocumentOutline();
  }, [openDocumentOutline, outlineOpen]);

  const setDocumentOutlineDock = useCallback((dock: "floating" | "left" | "right") => {
    setOutlineDock(dock);
    localStorage.setItem(OUTLINE_DOCK_KEY, dock);
    setOutlineOpen(true);
    if (dock !== "floating") openDocumentOutline();
  }, [openDocumentOutline]);

  const clearOutlineResize = useCallback(() => {
    if (outlineResizeCleanupRef.current) {
      outlineResizeCleanupRef.current();
      outlineResizeCleanupRef.current = null;
    }
    if (outlineResizePointerIdRef.current !== null) {
      document.body.style.cursor = "";
      localStorage.setItem(OUTLINE_WIDTH_KEY, String(outlineDockWidth));
      outlineResizePointerIdRef.current = null;
    }
  }, [outlineDockWidth]);

  useEffect(() => () => clearOutlineResize(), [clearOutlineResize]);

  const startOutlineResize = useCallback((event: React.PointerEvent<HTMLSpanElement>, side: "left" | "right") => {
    if (outlineDock === "floating") return;
    if (event.button !== 0 && event.button !== -1) return;
    event.preventDefault();
    event.stopPropagation();
    clearOutlineResize();
    document.body.style.cursor = "ew-resize";
    outlineResizeStartXRef.current = event.clientX;
    outlineResizeStartWidthRef.current = outlineDockWidth;
    const move = (moveEvent: PointerEvent) => {
      if (outlineResizePointerIdRef.current !== moveEvent.pointerId) return;
      const delta = moveEvent.clientX - outlineResizeStartXRef.current;
      const next = side === "right"
        ? outlineResizeStartWidthRef.current + delta
        : outlineResizeStartWidthRef.current - delta;
      setOutlineDockWidth(clampOutlineDockWidth(next));
    };
    const stop = (stopEvent: PointerEvent) => {
      if (outlineResizePointerIdRef.current !== stopEvent.pointerId) return;
      clearOutlineResize();
    };

    outlineResizePointerIdRef.current = event.pointerId;
    outlineResizeCleanupRef.current = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("pointercancel", stop);
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerup", stop, { passive: true });
    document.addEventListener("pointercancel", stop, { passive: true });
    if (event.currentTarget.setPointerCapture) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    move(event.nativeEvent);
  }, [clearOutlineResize, outlineDock, outlineDockWidth]);

  // 目录打开后在首次绘制前完成溢出判断和当前项居中。快速滚动按钮始终
  // 保留相同占位，因此状态切换不会改变标题栏或列表高度。
  useLayoutEffect(() => {
    if (!outlineOpen || activeOutlineIndex < 0) return;
    const list = outlineListRef.current;
    if (!list) return;
    const activeItem = list.querySelector<HTMLElement>(
      `[data-outline-index="${activeOutlineIndex}"]`,
    );
    const overflowing = list.scrollHeight > list.clientHeight + 1;
    setOutlineOverflow((current) => current === overflowing ? current : overflowing);
    if (!activeItem || !overflowing) {
      list.scrollTop = 0;
      return;
    }
    const centerActiveItem = () => {
      const listRect = list.getBoundingClientRect();
      const activeRect = activeItem.getBoundingClientRect();
      const activeTop = activeRect.top - listRect.top + list.scrollTop;
      const centeredTop = activeTop
        - (list.clientHeight - activeItem.offsetHeight) / 2;
      list.scrollTop = Math.max(0, Math.min(
        centeredTop,
        list.scrollHeight - list.clientHeight,
      ));
    };
    centerActiveItem();
    // content-visibility 会先用固有尺寸计算离屏项。首轮滚动使当前项进入
    // 可见区域后，再校正一次真实尺寸；标题栏不变，因此不会产生整体抖动。
    const frame = window.requestAnimationFrame(centerActiveItem);
    return () => window.cancelAnimationFrame(frame);
  }, [activeOutlineIndex, documentOutline.length, headingFoldRevision, outlineCollapsedHeadingKeys, outlineOpen]);

  const scrollOutlineTo = useCallback((target: "top" | "middle" | "bottom") => {
    const list = outlineListRef.current;
    if (!list) return;
    const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    const top = target === "top" ? 0 : target === "middle" ? maxScroll / 2 : maxScroll;
    list.scrollTo({ top, behavior: "smooth" });
  }, []);

  const currentBookmark = useMemo(() => {
    if (!editor) return undefined;
    return bookmarks.find((bookmark) => bookmark.position === bookmarkCursorPosition);
  }, [bookmarkCursorPosition, bookmarks, editor]);

  const toggleCurrentBookmark = useCallback(() => {
    if (!editor || readonly) return;
    toggleBookmark(editor);
  }, [editor, readonly]);

  const jumpToBookmark = useCallback((bookmark: DocumentBookmark) => {
    if (!editor || editor.isDestroyed) return;
    allHeadingFoldRoundTripRef.current = null;
    expandHeadingFoldsAt(editor, bookmark.position);
    window.requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      const position = Math.max(0, Math.min(editor.state.doc.content.size, bookmark.position));
      editor.chain().focus().setTextSelection(position).scrollIntoView().run();
    });
    setBookmarkOpen(false);
  }, [editor]);

  const editBookmarkLabel = useCallback((bookmark: DocumentBookmark) => {
    if (!editor || readonly) return;
    const label = window.prompt("书签名称（留空恢复正文摘要）", bookmark.label ?? "");
    if (label === null) return;
    renameBookmark(editor, bookmark.id, label);
  }, [editor, readonly]);

  // 专注模式下正文标题滚出视口后，App 顶栏中的文件名成为目录入口。
  // request id 只表达一次切换动作，避免普通重渲染反复开关面板。
  useEffect(() => {
    if (outlineRequestId === undefined || outlineRequestId === lastOutlineRequestIdRef.current) return;
    lastOutlineRequestIdRef.current = outlineRequestId;
    toggleDocumentOutline();
  }, [outlineRequestId, toggleDocumentOutline]);

  // 当 readonly 变化时同步编辑器状态
  useEffect(() => {
    editor?.setEditable(!readonly);
  }, [readonly, editor]);

  useEffect(() => {
    if (!focusMode) setFocusToolbarExpanded(false);
  }, [focusMode]);

  const revealSearchMatch = useCallback((requestedIndex: number, suppliedMatches?: SearchMatch[]) => {
    if (!editor) return;
    const matches = suppliedMatches ?? searchMatchesRef.current;
    if (!matches.length) return;
    const index = (requestedIndex + matches.length) % matches.length;
    const match = matches[index];
    setActiveSearchMatch(index);
    setSearchHighlights(editor, matches, index);
    expandHeadingFoldsAt(editor, match.from);

    // 防止浏览器先把整个编辑器滚到不可预测的位置，再把命中放到
    // 可视正文区域约 1/3 的高度，保留足够的前后文。
    editor.view.dom.focus({ preventScroll: true });
    editor.commands.setTextSelection({ from: match.from, to: match.to });
    requestAnimationFrame(() => {
      const root = scrollRef.current;
      if (!root || editor.isDestroyed) return;
      const rootRect = root.getBoundingClientRect();
      const sticky = root.querySelector<HTMLElement>(".note-editor-sticky");
      const stickyBottom = sticky?.getBoundingClientRect().bottom ?? rootRect.top;
      const visibleTop = Math.max(rootRect.top, Math.min(stickyBottom, rootRect.bottom));
      const targetTop = visibleTop + Math.max(24, (rootRect.bottom - visibleTop) * 0.30);
      const coords = editor.view.coordsAtPos(match.from);
      root.scrollTop += coords.top - targetTop;
    });
  }, [editor]);

  const closeEditorFind = useCallback(() => {
    setEditorFindOpen(false);
    searchMatchesRef.current = [];
    setSearchMatches([]);
    setActiveSearchMatch(0);
    if (editor && !editor.isDestroyed) setSearchHighlights(editor, [], 0);
  }, [editor]);

  const closeLineJump = useCallback(() => {
    setLineJumpOpen(false);
    setLineJumpError(null);
  }, []);

  const openLineJump = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    let currentLine = 1;
    const selectionPos = editor.state.selection.from;
    editor.state.doc.forEach((node, pos, index) => {
      if (selectionPos >= pos && selectionPos < pos + node.nodeSize) currentLine = index + 1;
    });
    closeEditorFind();
    setOutlineOpen(false);
    setLineJumpValue(String(currentLine));
    setLineJumpError(null);
    setLineJumpOpen(true);
    requestAnimationFrame(() => {
      lineJumpInputRef.current?.focus({ preventScroll: true });
      lineJumpInputRef.current?.select();
    });
  }, [closeEditorFind, editor]);

  const submitLineJump = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    const blockCount = editor.state.doc.childCount;
    if (!/^\d+$/.test(lineJumpValue.trim())) {
      setLineJumpError(`请输入 1–${blockCount}`);
      return;
    }
    const requestedLine = Number.parseInt(lineJumpValue, 10);
    if (requestedLine < 1 || requestedLine > blockCount) {
      setLineJumpError(`请输入 1–${blockCount}`);
      lineJumpInputRef.current?.select();
      return;
    }

    let blockPos = 0;
    editor.state.doc.forEach((_node, pos, index) => {
      if (index === requestedLine - 1) blockPos = pos;
    });
    const resolved = editor.state.doc.resolve(
      Math.min(blockPos + 1, editor.state.doc.content.size),
    );
    expandHeadingFoldsAt(editor, resolved.pos);
    const selection = TextSelection.near(resolved, 1);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    editor.view.dom.focus({ preventScroll: true });
    closeLineJump();

    requestAnimationFrame(() => {
      const root = scrollRef.current;
      if (!root || editor.isDestroyed) return;
      const rootRect = root.getBoundingClientRect();
      const stickyBottom = root.querySelector<HTMLElement>(".note-editor-sticky")
        ?.getBoundingClientRect().bottom ?? rootRect.top;
      const visibleTop = Math.max(rootRect.top, Math.min(stickyBottom, rootRect.bottom));
      const coords = editor.view.coordsAtPos(selection.from);
      root.scrollTo({
        top: Math.max(0, root.scrollTop + coords.top - visibleTop - 12),
        behavior: "smooth",
      });
    });
  }, [closeLineJump, editor, lineJumpValue]);

  const openEditorFind = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    closeLineJump();
    const { from, to } = editor.state.selection;
    const selected = from === to ? "" : editor.state.doc.textBetween(from, to, " ").trim();
    if (selected && !selected.includes("\n")) setEditorFindQuery(selected);
    setEditorFindOpen(true);
    requestAnimationFrame(() => {
      editorFindInputRef.current?.focus({ preventScroll: true });
      editorFindInputRef.current?.select();
    });
  }, [closeLineJump, editor]);

  const navigateEditorFind = useCallback((direction: number) => {
    const matches = searchMatchesRef.current;
    if (!matches.length) return;
    const requestedIndex = activeSearchMatch < 0
      ? searchMatchIndexFromPosition(matches, editorFindOriginRef.current, direction)
      : activeSearchMatch + direction;
    revealSearchMatch(requestedIndex, matches);
    requestAnimationFrame(() => editorFindInputRef.current?.focus({ preventScroll: true }));
  }, [activeSearchMatch, revealSearchMatch]);

  useEffect(() => {
    vimSearchActionRef.current = (direction) => {
      const matches = searchMatchesRef.current;
      if (direction === 0 || matches.length === 0) {
        openEditorFind();
        return;
      }
      const requestedIndex = activeSearchMatch < 0
        ? searchMatchIndexFromPosition(matches, editorFindOriginRef.current, direction)
        : activeSearchMatch + direction;
      revealSearchMatch(requestedIndex, matches);
      requestAnimationFrame(() => editor?.commands.focus());
    };
    return () => {
      vimSearchActionRef.current = () => undefined;
    };
  }, [activeSearchMatch, editor, openEditorFind, revealSearchMatch]);

  const jumpToOutlineHeading = useCallback((item: DocumentOutlineItem) => {
    if (!editor || editor.isDestroyed) return;
    allHeadingFoldRoundTripRef.current = null;
    const position = Math.min(item.pos + 1, editor.state.doc.content.size);
    expandHeadingFoldsAt(editor, position);
    editor.commands.setTextSelection(position);
    editor.view.focus();
    setOutlineOpen(false);
    requestAnimationFrame(() => {
      const root = scrollRef.current;
      if (!root || editor.isDestroyed) return;
      const rootRect = root.getBoundingClientRect();
      const stickyBottom = root.querySelector<HTMLElement>(".note-editor-sticky")
        ?.getBoundingClientRect().bottom ?? rootRect.top;
      const coords = editor.view.coordsAtPos(position);
      const nextTop = root.scrollTop + coords.top - Math.max(rootRect.top, stickyBottom) - 12;
      root.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
    });
  }, [editor]);

  // 拦截 WebView 原生 Cmd+F，并为 Windows 提供 Alt+F。Ctrl+F 不再
  // 触发搜索：Vim 模式用它向下翻页，非 Vim 模式也不唤起 WebView 查找框。
  // 原生查找框由
  // WebView 管理且主窗口 hide 后可能残留；应用内查找框与编辑器共用生命周期。
  useEffect(() => {
    if (!editor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isCtrlF = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        && (event.code === "KeyF" || event.key.toLocaleLowerCase() === "f");
      if (isCtrlF) {
        const target = event.target;
        const vimMode = getVimEditorMode(editor);
        const isVimEditorTarget = target instanceof Node
          && editor.view.dom.contains(target)
          && vimMode !== null
          && vimMode !== "insert";
        // ProseMirror 会忽略在捕获阶段已 preventDefault 的事件。Normal/Visual
        // 模式必须先交给 Vim 插件处理；插件返回 true 后会自行阻止浏览器查找。
        if (isVimEditorTarget) return;
        event.preventDefault();
        return;
      }
      if (isDocumentFindKeyEvent(event)) {
        event.preventDefault();
        event.stopPropagation();
        openEditorFind();
        return;
      }
      if (isEditorLineJumpKeyEvent(event)) {
        event.preventDefault();
        event.stopPropagation();
        openLineJump();
        return;
      }
      if (event.key === "Escape" && lineJumpOpen) {
        event.preventDefault();
        closeLineJump();
        editor.commands.focus();
        return;
      }
      if (event.key === "Escape" && editorFindOpen) {
        event.preventDefault();
        closeEditorFind();
        editor.commands.focus();
      }
    };
    const onWindowHidden = () => {
      closeEditorFind();
      closeLineJump();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") onWindowHidden();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("nine-rings:main-window-hide", onWindowHidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("nine-rings:main-window-hide", onWindowHidden);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [closeEditorFind, closeLineJump, editor, editorFindOpen, lineJumpOpen, openEditorFind, openLineJump]);

  useEffect(() => {
    if (!editor || !editorFindOpen) return;
    const query = editorFindQuery.trim();
    const matches = query ? findSearchMatches(editor.state.doc, query) : [];
    editorFindOriginRef.current = editor.state.selection.from;
    searchMatchesRef.current = matches;
    setSearchMatches(matches);
    setActiveSearchMatch(-1);
    setSearchHighlights(editor, matches, -1);
  }, [editor, editorFindOpen, editorFindQuery]);

  // 接收搜索列表传来的一次性定位请求。优先匹配完整短语；FTS 的
  // 多词 AND 查询若没有连续短语，则回退到各个词的命中位置。
  useEffect(() => {
    if (!editor || !searchTarget || searchTarget.noteId !== noteId) return;
    let matches = findSearchMatches(editor.state.doc, searchTarget.query);
    if (matches.length === 0) {
      const terms = Array.from(new Set(searchTarget.query.trim().split(/\s+/).filter(Boolean)));
      if (terms.length > 1) {
        matches = terms
          .flatMap((term) => findSearchMatches(editor.state.doc, term))
          .sort((a, b) => a.from - b.from || a.to - b.to)
          .filter((match, index, all) => index === 0 || match.from !== all[index - 1].from || match.to !== all[index - 1].to);
      }
    }

    searchMatchesRef.current = matches;
    setSearchMatches(matches);
    setActiveSearchMatch(0);

    if (matches.length > 0) {
      revealSearchMatch(0, matches);
    } else {
      setSearchHighlights(editor, [], 0);
      const input = titleInputRef.current;
      const titleText = title ?? "";
      const loweredTitle = titleText.toLocaleLowerCase();
      let index = loweredTitle.indexOf(searchTarget.query.toLocaleLowerCase());
      let length = searchTarget.query.length;
      if (index < 0) {
        const term = searchTarget.query.trim().split(/\s+/).find((part) => loweredTitle.includes(part.toLocaleLowerCase()));
        if (term) {
          index = loweredTitle.indexOf(term.toLocaleLowerCase());
          length = term.length;
        }
      }
      if (input && index >= 0) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(index, index + length);
        scrollRef.current?.scrollTo({ top: 0 });
      }
    }
    onSearchTargetConsumed?.(searchTarget.requestId);
  }, [editor, noteId, onSearchTargetConsumed, revealSearchMatch, searchTarget, title]);

  // 宽度变化会让软换行重排。编辑且光标可见时锚定光标；只读、失焦或
  // 光标不在视口内时锚定顶部第一个可见块，避免横竖屏切换跳到旧选区。
  useEffect(() => {
    if (!editor) return;
    const root = scrollRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;

    let frame = 0;
    let restoreFrame = 0;
    let followupRestoreFrame = 0;
    let scrollCaptureTimer = 0;
    let scrollGestureActive = false;
    let adjusting = false;
    let lastObservedWidth = root.clientWidth;
    let lastWindowWidth = window.innerWidth;
    let anchor: {
      kind: "caret" | "block";
      pos: number;
      viewportTop: number;
      viewportHeight: number;
      relativeRatio: number;
      width: number;
      blockElement?: HTMLElement;
    } | null = null;

    const blockPosition = (element: HTMLElement) => {
      const domPosition = editor.view.posAtDOM(element, 0, -1);
      const position = Math.max(0, Math.min(domPosition, editor.state.doc.content.size));
      const $position = editor.state.doc.resolve(position);
      return $position.depth >= 1 ? $position.before(1) : position;
    };

    const capture = () => {
      frame = 0;
      if (adjusting || editor.isDestroyed || !root.isConnected) return;
      const viewport = editorReadingViewport(root);
      const pos = Math.min(editor.state.selection.head, editor.state.doc.content.size);
      const coords = editor.view.coordsAtPos(pos);
      const caretVisible = !readonly
        && editor.isFocused
        && coords.bottom >= viewport.top
        && coords.top <= viewport.bottom;
      if (caretVisible) {
        anchor = {
          kind: "caret",
          pos,
          viewportTop: coords.top,
          viewportHeight: viewport.height,
          relativeRatio: (coords.top - viewport.top) / viewport.height,
          width: root.clientWidth,
        };
        return;
      }

      // posAtCoords 直接利用 ProseMirror 的文档映射定位视口顶部块。旧实现
      // 从第一个 DOM 块开始逐个读取 rect，滚到长文档后部时每帧接近 O(N)。
      const editorRect = editor.view.dom.getBoundingClientRect();
      const probeX = Math.min(editorRect.right - 1, Math.max(editorRect.left + 1, editorRect.left + 48));
      let block: HTMLElement | null = null;
      for (const offset of [1, 8, 24, 48]) {
        const coords = { left: probeX, top: Math.min(viewport.bottom - 1, viewport.top + offset) };
        const mapped = editor.view.posAtCoords(coords)?.pos;
        if (mapped === undefined) continue;
        const $mapped = editor.state.doc.resolve(Math.max(0, Math.min(mapped, editor.state.doc.content.size)));
        const blockPos = $mapped.depth >= 1 ? $mapped.before(1) : mapped;
        const candidate = editor.view.nodeDOM(blockPos);
        if (!(candidate instanceof HTMLElement)) continue;
        const rect = candidate.getBoundingClientRect();
        if (rect.height > 0 && rect.bottom > viewport.top + 0.5 && rect.top < viewport.bottom) {
          block = candidate;
          break;
        }
      }
      if (!block) {
        anchor = null;
        return;
      }
      const blockRect = block.getBoundingClientRect();
      anchor = {
        kind: "block",
        pos: blockPosition(block),
        viewportTop: blockRect.top - viewport.top,
        viewportHeight: viewport.height,
        relativeRatio: 0,
        width: root.clientWidth,
        blockElement: block,
      };
    };
    const scheduleCapture = () => {
      if (!frame) frame = requestAnimationFrame(capture);
    };
    const cancelSettledScrollCapture = () => {
      if (!scrollCaptureTimer) return;
      window.clearTimeout(scrollCaptureTimer);
      scrollCaptureTimer = 0;
    };
    const captureAfterScrollSettles = () => {
      if (adjusting) return;
      // 每段连续滚动只在开始时取一次锚点，确保用户刚停下便旋转屏幕时
      // 仍有较新的位置；后续滚动帧只重置静止定时器，不再做布局读取。
      if (!scrollGestureActive) {
        scrollGestureActive = true;
        scheduleCapture();
      }
      cancelSettledScrollCapture();
      // 位置锚点只用于将来的宽度/方向变化，不需要跟随滚动逐帧更新。
      // posAtCoords/coordsAtPos 都可能触发布局与命中测试；把它们留到
      // 滚动静止后，避免阻塞 WebKit 分块绘制。
      scrollCaptureTimer = window.setTimeout(() => {
        scrollCaptureTimer = 0;
        scrollGestureActive = false;
        scheduleCapture();
      }, 140);
    };

    const restoreAnchor = (previous: NonNullable<typeof anchor>) => {
      if (editor.isDestroyed || !root.isConnected) return;
      const viewport = editorReadingViewport(root);
      const pos = Math.min(previous.pos, editor.state.doc.content.size);
      if (previous.kind === "block") {
        const block = previous.blockElement?.isConnected
          ? previous.blockElement
          : editor.view.nodeDOM(pos);
        if (!(block instanceof HTMLElement)) return;
        const targetTop = viewport.top + previous.viewportTop;
        root.scrollTop += block.getBoundingClientRect().top - targetTop;
        return;
      }
      const nextTop = editor.view.coordsAtPos(pos).top;
      const heightChanged = Math.abs(viewport.height - previous.viewportHeight) > 24;
      const unclampedTarget = heightChanged
        ? viewport.top + previous.relativeRatio * viewport.height
        : previous.viewportTop;
      const targetTop = Math.min(
        viewport.bottom - 32,
        Math.max(viewport.top + 16, unclampedTarget),
      );
      root.scrollTop += nextTop - targetTop;
    };

    const clearSettleTimers = () => {
      cancelSettledScrollCapture();
      scrollGestureActive = false;
      if (restoreFrame) cancelAnimationFrame(restoreFrame);
      restoreFrame = 0;
      if (followupRestoreFrame) cancelAnimationFrame(followupRestoreFrame);
      followupRestoreFrame = 0;
    };

    const stabilizeWidthChange = (force = false) => {
      const nextWidth = root.clientWidth;
      if ((!force && Math.abs(nextWidth - lastObservedWidth) < 24) || !anchor) return false;
      if (Math.abs(nextWidth - lastObservedWidth) >= 24) lastObservedWidth = nextWidth;
      const previous = anchor;
      adjusting = true;
      clearSettleTimers();
      restoreFrame = requestAnimationFrame(() => {
        restoreFrame = 0;
        restoreAnchor(previous);
        // 第一帧完成宽度重排，第二帧吸收 WebKit 的滚动夹取。之后只响应
        // 真正的 ResizeObserver/visualViewport 事件，不再延迟拉动页面。
        followupRestoreFrame = requestAnimationFrame(() => {
          followupRestoreFrame = 0;
          restoreAnchor(previous);
          adjusting = false;
          scheduleCapture();
        });
      });
      return true;
    };

    const observer = new ResizeObserver(() => {
      if (stabilizeWidthChange() || adjusting) return;
      const nextWidth = root.clientWidth;
      if (!anchor || Math.abs(nextWidth - anchor.width) < 0.5) {
        scheduleCapture();
        return;
      }
      const previous = anchor;
      requestAnimationFrame(() => {
        if (editor.isDestroyed || !root.isConnected) return;
        adjusting = true;
        restoreAnchor(previous);
        adjusting = false;
        scheduleCapture();
      });
    });

    const onWindowResize = () => {
      const windowWidthChanged = Math.abs(window.innerWidth - lastWindowWidth) >= 24;
      lastWindowWidth = window.innerWidth;
      if (!stabilizeWidthChange(windowWidthChanged)) scheduleCapture();
    };

    const captureBeforeFullscreen = () => {
      // setFullscreen 之后 macOS 会立即进入异步 Space 动画。必须在第一
      // 次 resize 之前同步保存锚点，不能等待滚动静止计时器。
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      capture();
    };

    editor.on("selectionUpdate", scheduleCapture);
    editor.on("focus", scheduleCapture);
    root.addEventListener("scroll", captureAfterScrollSettles, { passive: true });
    window.addEventListener("resize", onWindowResize);
    window.addEventListener(FULLSCREEN_WILL_CHANGE_EVENT, captureBeforeFullscreen);
    observer.observe(root);
    scheduleCapture();
    return () => {
      editor.off("selectionUpdate", scheduleCapture);
      editor.off("focus", scheduleCapture);
      root.removeEventListener("scroll", captureAfterScrollSettles);
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener(FULLSCREEN_WILL_CHANGE_EVENT, captureBeforeFullscreen);
      observer.disconnect();
      clearSettleTimers();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [editor, readonly]);

  // 打开标题下拉时自动检测是否存在 H6（切换至页 1）
  useEffect(() => {
    if (!headingOpen || !editor) return;
    try {
      const json = editor.getJSON();
      const scan = (node: any): boolean => {
        if (node.type === 'heading' && node.attrs?.level > 5) return true;
        if (Array.isArray(node.content)) return node.content.some(scan);
        return false;
      };
      if (scan(json)) setHeadingPage(1);
    } catch { /* ignore */ }
  }, [headingOpen, editor]);

  // ── 滚动位置记忆（localStorage 持久化，跨刷新保持）──

  useLayoutEffect(() => {
    if (!editor) return;
    const saved = localStorage.getItem(`selectionPos:${noteId}`);
    if (!saved) return;
    try {
      const selection = JSON.parse(saved) as { from?: number; to?: number };
      const maximum = editor.state.doc.content.size;
      const from = Math.min(maximum, Math.max(1, Number(selection.from) || 1));
      const to = Math.min(maximum, Math.max(from, Number(selection.to) || from));
      editor.commands.setTextSelection({ from, to });
    } catch {
      localStorage.removeItem(`selectionPos:${noteId}`);
    }
  }, [editor, noteId]);

  // 挂载时恢复滚动位置
  // 出处：SO #54195164 https://stackoverflow.com/questions/54195164
  // useLayoutEffect 在浏览器绘制前执行，比 useEffect 更早恢复位置
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = localStorage.getItem('scrollPos:' + noteId);
    const opsCount = Array.isArray(content) ? (content as any[]).length : 0;
    addLog(`[加载] ${title}  id=${noteId.slice(0,8)} ops=${opsCount} 恢复位置=${saved ?? '无'}`);
    if (saved === null) {
      return;
    }
    const scrollTop = Number(saved);
    let retries = 8;
    const restore = () => {
      requestAnimationFrame(() => {
        el.scrollTop = scrollTop;
        if (--retries > 0) restore();
      });
    };
    restore();
  }, [noteId]);

  // 滚动时保存位置 & 更新位置显示
  // 出处：TipTap #2342 https://github.com/ueberdosis/tiptap/issues/2342
  // 滚动事件持续保存正确的位置；cleanup 不做覆写（防止编辑器销毁阶段 scrollTop 被复位为 0）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let statusTimer = 0;
    let persistTimer = 0;
    let maximumScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    let lastKnownScrollTop = Number(localStorage.getItem(`scrollPos:${noteId}`)) || 0;
    const showLivePosition = showStatusBar && !isMobileToolbarViewport;
    const persistPosition = () => {
      localStorage.setItem(`scrollPos:${noteId}`, String(lastKnownScrollTop));
    };
    const updateStatusPosition = () => {
      const percentage = maximumScroll > 0
        ? Math.max(0, Math.min(100, Math.round(lastKnownScrollTop / maximumScroll * 100)))
        : 0;
      if (scrollPositionRef.current) {
        scrollPositionRef.current.textContent = `位置 ${percentage}%`;
      }
    };
    const scheduleStatusPosition = () => {
      if (!showLivePosition || statusTimer) return;
      // 状态文字无需 60Hz 更新；10Hz 足够跟手，并且这里完全复用缓存的
      // 可滚动高度，不在滚动热路径读取 scrollHeight 触发布局。
      statusTimer = window.setTimeout(() => {
        statusTimer = 0;
        updateStatusPosition();
      }, 100);
    };
    const refreshMaximumScroll = () => {
      maximumScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (showLivePosition) scheduleStatusPosition();
    };
    const flushPosition = () => {
      if (persistTimer) window.clearTimeout(persistTimer);
      persistTimer = 0;
      persistPosition();
    };
    const handler = () => {
      lastKnownScrollTop = el.scrollTop;
      scheduleStatusPosition();
      if (persistTimer) window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(flushPosition, 220);
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === "hidden") flushPosition();
    };
    lastKnownScrollTop = el.scrollTop;
    updateStatusPosition();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(refreshMaximumScroll);
    resizeObserver?.observe(el);
    const contentShell = el.querySelector<HTMLElement>(".editor-content-shell");
    if (contentShell) resizeObserver?.observe(contentShell);
    el.addEventListener("scroll", handler, { passive: true });
    window.addEventListener("pagehide", flushPosition);
    window.addEventListener("nine-rings:main-window-hide", flushPosition);
    document.addEventListener("visibilitychange", persistWhenHidden);
    return () => {
      el.removeEventListener("scroll", handler);
      window.removeEventListener("pagehide", flushPosition);
      window.removeEventListener("nine-rings:main-window-hide", flushPosition);
      document.removeEventListener("visibilitychange", persistWhenHidden);
      resizeObserver?.disconnect();
      // 关键修复：cleanup 时 DOM 可能已进入销毁阶段，scrollTop 被误读为 0
      // 此时不覆写——滚动事件已经在用户滚动时写入了正确值
      addLog(`[离开] ${noteId.slice(0,8)} 保存位置=${el.scrollTop}`);
      flushPosition();
      if (statusTimer) window.clearTimeout(statusTimer);
    };
  }, [isMobileToolbarViewport, noteId, showStatusBar]);

  const { chars, words } = documentStats;

  // ── Image: paste / drop ──

  /** 尝试从 URL 抓取页面标题（3s 超时，失败返回 null） */
  const fetchUrlTitle = async (url: string): Promise<string | null> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      const resp = await fetch(url, { signal: ctrl.signal });
      const html = await resp.text();
      const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      return m ? m[1].trim().replace(/\s+/g, " ") : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const URL_RE = /^https?:\/\/\S+$/;

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || !editor) return;
      if (vimModeEnabled && getVimEditorMode(editor) !== "insert") {
        e.preventDefault();
        return;
      }

      // ── URL 粘贴：自动抓标题 ──
      const plainText = e.clipboardData.getData("text/plain").trim();
      if (plainText && URL_RE.test(plainText)) {
        e.preventDefault();
        // 先插入 URL
        editor.chain().focus().insertContent(plainText).run();
        // 异步抓取标题
        fetchUrlTitle(plainText).then((title) => {
          if (!title) {
            // 抓取失败，把 URL 变成可点击链接
            const { from } = editor.state.selection;
            const pos = editor.state.doc.resolve(from);
            const textBefore = pos.parent?.textContent ?? "";
            const idx = textBefore.lastIndexOf(plainText);
            if (idx === -1) return;
            const start = pos.start() + idx;
            editor.chain()
              .setTextSelection({ from: start, to: start + plainText.length })
              .setLink({ href: plainText })
              .setTextSelection(start + plainText.length)
              .run();
            return;
          }
          // 找到刚插入的 URL 文本位置并替换为标题+链接
          const { from } = editor.state.selection;
          const pos = editor.state.doc.resolve(from);
          const textBefore = pos.parent?.textContent ?? "";
          const idx = textBefore.lastIndexOf(plainText);
          if (idx === -1) return;
          const start = pos.start() + idx;
          editor.chain()
            .setTextSelection({ from: start, to: start + plainText.length })
            .deleteSelection()
            .insertContent(title)
            .setLink({ href: plainText })
            .setTextSelection(start + title.length)
            .run();
        });
        return;
      }

      // 浏览器和聊天应用复制 Markdown 时通常会同时提供 text/html。
      // 高置信 Markdown 应优先按源码解析；普通富文本（包括 HTML 表格）
      // 因 looksLikeMarkdown 为 false，仍交给编辑器保留原格式。
      if (plainText && looksLikeMarkdown(plainText)) {
        e.preventDefault();
        const parsed = deltaToProseMirror(mdToDelta(plainText));
        editor.chain().focus().insertContent(parsed.content).run();
        setMarkdownPasteText(plainText);
        return;
      }

      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          storeImage(file).then((ref) => {
            const { $from } = editor.state.selection;
            // ResizableImage 是 block node，不能在段落中间插入。
            // 在光标所在段落的末尾之后插入图片节点。
            const pos = $from.after($from.depth);
            editor.chain().focus().insertContentAt(pos, {
              type: "resizableImage",
              attrs: { src: ref },
            }).run();
          });
        }
      }
    },
    [editor, vimModeEnabled],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files || !editor) return;
      if (vimModeEnabled && getVimEditorMode(editor) !== "insert") {
        e.preventDefault();
        return;
      }
      for (const file of Array.from(files)) {
        if (file.type.startsWith("image/")) {
          e.preventDefault();
          storeImage(file).then((ref) => {
            (editor.chain().focus() as any).setResizableImage({ src: ref }).run();
          });
        }
      }
    },
    [editor, vimModeEnabled],
  );

  const insertImageUrl = () => {
    if (!editor || !imageUrl.trim()) return;
    (editor.chain().focus() as any).setResizableImage({ src: imageUrl.trim() }).run();
    setImageUrl("");
    setImageDialog(false);
  };

  // ── Wiki Link 选择 ──

  const selectWikiLink = (note: { title: string; id: string }) => {
    if (!editor || wikiStartRef.current === null) return;
    const start = wikiStartRef.current;
    const end = editor.state.selection.from;
    editor.chain()
      .focus()
      .deleteRange({ from: start, to: end })
      .insertContent(note.title)
      .setLink({ href: `nr-note://${note.id}` })
      .setTextSelection(start + note.title.length)
      .run();
    setWikiOpen(false);
    wikiStartRef.current = null;
  };

  // ── Tags ──

  const addTag = (raw: string) => {
    const t = raw.trim();
    if (!t || tags.includes(t)) return;
    onTagsChange([...tags, t]);
  };

  const removeTag = (t: string) => {
    onTagsChange(tags.filter((x) => x !== t));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
      setTagInput("");
    }
    if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      onTagsChange(tags.slice(0, -1));
    }
  };

  const handleExportPdf = useCallback(() => {
    if (!editor) return;
    const opened = exportDocumentAsPdf({
      title: localTitle.trim() || "无标题",
      contentHtml: editor.getHTML(),
      metadata: pdfDocumentInfo,
    });
    if (!opened) {
      window.alert(isTauri()
        ? "无法启动系统打印界面，请确认系统打印服务可用后重试。"
        : "无法打开 PDF 打印页，请允许此站点打开弹出窗口后重试。");
    }
  }, [editor, localTitle, pdfDocumentInfo]);

  useEffect(() => {
    if (!editor || pdfExportRequestId === undefined || pdfExportRequestId === lastPdfExportRequestIdRef.current) return;
    lastPdfExportRequestIdRef.current = pdfExportRequestId;
    handleExportPdf();
  }, [editor, handleExportPdf, pdfExportRequestId]);

  // 设置面板中的任意修改都会让 App 更新一次。标题索引与长文档长度成
  // 正比，因此只在 ProseMirror 文档快照或折叠状态真正变化时重算。
  const editorDocument = editor?.state.doc;
  const headingSections = useMemo(
    () => editorDocument ? extractHeadingSections(editorDocument) : [],
    [editorDocument],
  );
  const headingSectionByPosition = useMemo(
    () => new Map(headingSections.map((section) => [section.pos, section])),
    [headingSections],
  );
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    setOutlineCollapsedHeadingKeys(new Set(getCollapsedHeadingKeys(editor)));
  }, [editor, headingFoldRevision]);
  const toggleEditorHeadingFromGutter = useCallback((position: number) => {
    if (!editor || editor.isDestroyed) return;
    const section = headingSectionByPosition.get(position);
    if (!section) return;
    const root = scrollRef.current;
    const heading = editor.view.nodeDOM(section.pos);
    const anchor = root && heading instanceof HTMLElement
      ? {
          position: section.pos,
          offsetTop: heading.getBoundingClientRect().top - editorReadingViewport(root).top,
        }
      : null;

    allHeadingFoldRoundTripRef.current = null;
    // gutter 点击以标题自身为锚点，不请求 ProseMirror 围绕旧选区滚动。
    if (!toggleHeadingSectionFold(editor, section, false) || !root || !anchor) return;
    const restore = () => restoreEditorViewportAnchor(
      editor,
      root,
      anchor,
      headingSections,
      getCollapsedHeadingKeys(editor),
    );
    restore();
    if (headingFoldViewportFrameRef.current !== null) {
      window.cancelAnimationFrame(headingFoldViewportFrameRef.current);
    }
    headingFoldViewportFrameRef.current = window.requestAnimationFrame(() => {
      headingFoldViewportFrameRef.current = null;
      restore();
    });
  }, [editor, headingSectionByPosition, headingSections]);
  const setAllHeadingFoldsKeepingViewport = useCallback((folded: boolean) => {
    if (!editor || editor.isDestroyed) return;
    const root = scrollRef.current;
    if (!root) {
      setAllHeadingFolds(editor, folded);
      return;
    }
    if (headingFoldViewportFrameRef.current !== null) {
      window.cancelAnimationFrame(headingFoldViewportFrameRef.current);
      headingFoldViewportFrameRef.current = null;
    }

    const currentAnchor = captureEditorViewportAnchor(editor, root);
    const existing = allHeadingFoldRoundTripRef.current;
    const validRoundTrip = existing
      && existing.noteId === noteId
      && existing.document === editor.state.doc;
    const stayedAtCollapsedViewport = Boolean(validRoundTrip && !existing.userMoved);

    let anchorToRestore = currentAnchor;
    let roundTrip: AllHeadingFoldRoundTrip | null = null;
    if (folded) {
      // 连续点按“全部折叠”且期间没有移动视口时，保留第一次折叠前的
      // 原始位置；若用户已经滚到别处，则从当前位置开始新的往返。
      roundTrip = validRoundTrip && stayedAtCollapsedViewport
        ? existing
        : currentAnchor
          ? {
              noteId,
              document: editor.state.doc,
              originalAnchor: currentAnchor,
              userMoved: false,
            }
          : null;
      allHeadingFoldRoundTripRef.current = roundTrip;
    } else {
      if (validRoundTrip && stayedAtCollapsedViewport) {
        anchorToRestore = existing.originalAnchor;
      }
      allHeadingFoldRoundTripRef.current = null;
    }

    setAllHeadingFolds(editor, folded);
    if (!anchorToRestore) return;

    const restore = () => restoreEditorViewportAnchor(
      editor,
      root,
      anchorToRestore!,
      headingSections,
      getCollapsedHeadingKeys(editor),
    );
    restore();

    // WebKit 可能在当前事件结束时再次按新 scrollHeight 夹取 scrollTop；
    // 下一绘制帧校正一次即可，无需持续监听或逐帧测量。
    headingFoldViewportFrameRef.current = window.requestAnimationFrame(() => {
      headingFoldViewportFrameRef.current = null;
      restore();
    });
  }, [editor, headingSections, noteId]);

  const setAllOutlineFolds = useCallback((folded: boolean) => {
    setOutlineCollapsedHeadingKeys(new Set(
      folded ? collapsedHeadingKeysForAll(headingSections) : [],
    ));
  }, [headingSections]);

  const toggleOutlineTreeHeading = useCallback((position: number) => {
    const section = headingSections.find((candidate) => candidate.pos === position);
    if (!section || section.end <= section.headingEnd) return;
    toggleEditorHeadingFromGutter(position);
    setOutlineCollapsedHeadingKeys((current) => {
      const next = new Set(current);
      if (next.has(section.key)) next.delete(section.key);
      else next.add(section.key);
      return next;
    });
  }, [headingSections, toggleEditorHeadingFromGutter]);

  const outlineVisibleHeadingPositions = useMemo(
    () => new Set(
      visibleHeadingSections(headingSections, outlineCollapsedHeadingKeys)
        .map((section) => section.pos),
    ),
    [headingSections, outlineCollapsedHeadingKeys],
  );
  const visibleOutlineEntries = useMemo<VisibleOutlineEntry[]>(() => (
    documentOutline
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => outlineVisibleHeadingPositions.has(item.pos))
      .map(({ item, index }) => ({
        item,
        index,
        folded: Boolean(
          headingSectionByPosition.get(item.pos)
          && outlineCollapsedHeadingKeys.has(headingSectionByPosition.get(item.pos)!.key)
        ),
      }))
  ), [documentOutline, headingSectionByPosition, outlineCollapsedHeadingKeys, outlineVisibleHeadingPositions]);

  if (!editor) return <div className="note-editor"><div className="empty-state">加载中...</div></div>;

  const rememberToolbarSelection = () => {
    if (editor.state.selection instanceof CellSelection) {
      toolbarCellSelectionRef.current = editor.state.selection;
      toolbarSelectionRef.current = null;
      return;
    }
    const { from, to } = editor.state.selection;
    if (from !== to) {
      toolbarSelectionRef.current = { from, to };
      return;
    }
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.isCollapsed || !domSelection.anchorNode || !domSelection.focusNode) return;
    try {
      const anchor = editor.view.posAtDOM(domSelection.anchorNode, domSelection.anchorOffset);
      const focus = editor.view.posAtDOM(domSelection.focusNode, domSelection.focusOffset);
      toolbarSelectionRef.current = { from: Math.min(anchor, focus), to: Math.max(anchor, focus) };
    } catch {
      // The browser can briefly expose a selection outside ProseMirror while moving focus.
    }
  };

  const runToolbarFormat = (format: "bold" | "italic" | "strike") => {
    let chain = editor.chain();
    const selection = toolbarSelectionRef.current;
    if (selection) chain = chain.setTextSelection(selection);
    chain = chain.focus();
    if (format === "bold") chain.toggleBold().run();
    else if (format === "italic") chain.toggleItalic().run();
    else chain.toggleStrike().run();
  };

  const toggleMobileToolbarMenu = (
    menu: "style" | "heading" | "block" | "table" | "clip" | "link" | "size" | "color" | "more",
    isOpen: boolean,
  ) => {
    setStyleOpen(false);
    setHeadingOpen(false);
    setBlockOpen(false);
    setTableOpen(false);
    setClipOpen(false);
    setLinkOpen(false);
    setSizeOpen(false);
    setColorOpen(false);
    setMoreOpen(false);
    if (isOpen) return;
    if (menu === "style") setStyleOpen(true);
    else if (menu === "heading") setHeadingOpen(true);
    else if (menu === "block") setBlockOpen(true);
    else if (menu === "table") setTableOpen(true);
    else if (menu === "clip") setClipOpen(true);
    else if (menu === "link") setLinkOpen(true);
    else if (menu === "size") setSizeOpen(true);
    else if (menu === "color") setColorOpen(true);
    else setMoreOpen(true);
  };

  const totalBlocks = gutterBlockCount || editor.state.doc.childCount;

  // ── 剪贴板操作 ──
  const handleCopy = async () => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = clipboardSliceToPlainText(editor.state.selection.content());
    await copyToClipboard(text);
    editor.commands.focus();
  };
  const handleCut = async () => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = clipboardSliceToPlainText(editor.state.selection.content());
    await copyToClipboard(text);
    editor.chain().focus().deleteSelection().run();
  };
  const handleClipboardPaste = async () => {
    try {
      // 与原生 Ctrl+V 保持一致：代码编辑器复制 Markdown 时通常同时提供
      // text/plain 和 text/html，必须先判断源码，否则列表会被当成普通 HTML 文本。
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes("text/plain")) {
          const blob = await item.getType("text/plain");
          const plainText = (await blob.text()).trim();
          if (plainText && looksLikeMarkdown(plainText)) {
            const parsed = deltaToProseMirror(mdToDelta(plainText));
            editor.chain().focus().insertContent(parsed.content).run();
            setMarkdownPasteText(plainText);
            return;
          }
        }
      }
      for (const item of items) {
        if (item.types.includes("text/html")) {
          const blob = await item.getType("text/html");
          const html = await blob.text();
          editor.chain().focus().insertContent(normalizeSingleParagraphHTML(html)).run();
          return;
        }
      }
      // 回退：普通纯文本，去除首尾空白以防空段落
      const text = await navigator.clipboard.readText();
      const trimmed = text.replace(/^\s+|\s+$/g, '');
      if (trimmed) {
        editor.chain().focus().insertContent(trimmed).run();
      }
    } catch { /* 权限拒绝静默忽略 */ }
  };

  // ── 正文右键菜单 ──
  const handleEditorContextMenu = (e: React.MouseEvent) => {
    if (!useCustomContextMenu) return; // 关闭开关 → 系统原生菜单
    e.preventDefault();
    e.stopPropagation();
    setContextSubmenu(null);
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const hasSelection = () => {
    const { from, to } = editor.state.selection;
    return from !== to;
  };

  const convertSelectionFromMarkdown = () => {
    const { from, to, empty } = editor.state.selection;
    if (empty || readonly) return;

    let unsupported = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isLeaf && !node.isText && node.type.name !== "hardBreak") {
        unsupported = true;
        return false;
      }
      return true;
    });
    if (unsupported) return;

    const markdown = editor.state.doc.textBetween(from, to, "\n", "\n");
    if (!markdown.trim()) return;
    const parsed = deltaToProseMirror(mdToDelta(markdown));
    editor.chain().focus().insertContentAt({ from, to }, parsed.content).run();
    setMarkdownSelectionNotice(true);
    setBlockOpen(false);
    setContextMenu(null);
  };

  const insertLink = () => {
    const url = linkDialogUrl.trim();
    if (!url) return;
    const { from, to } = editor.state.selection;
    if (from !== to) {
      // 有选区：把选中文字变成链接
      editor.chain().focus().setLink({ href: url }).run();
    } else {
      // 无选区：插入 URL 本身作为链接文本
      editor.chain().focus()
        .insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] })
        .run();
    }
    setLinkDialogUrl("");
    setLinkDialog(false);
  };

  // ── 代码块：多段选区合并为单个代码块 ──
  const handleToggleCodeBlock = () => {
    if (!editor) return;

    // 已在代码块中 → 转为普通段落
    if (editor.isActive('codeBlock')) {
      editor.chain().focus().setNode('paragraph').run();
      return;
    }

    const { from, to } = editor.state.selection;

    // 无选区或单块 → 转为代码块
    let blockCount = 0;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isBlock && !node.type.name.endsWith('List') && node.type.name !== 'listItem' && node.type.name !== 'doc') blockCount++;
      return true;
    });

    if (blockCount <= 1) {
      editor.chain().focus().setNode('codeBlock').run();
      return;
    }

    // 多块选区 → 合并为一个代码块，用 \\n 连接
    const text = editor.state.doc.textBetween(from, to, '\n');
    editor.chain().focus()
      .deleteRange({ from, to })
      .insertContentAt(from, {
        type: 'codeBlock',
        content: text ? [{ type: 'text', text }] : [],
      })
      .run();

    // 关闭下拉菜单（窄屏场景）
    setBlockOpen(false);
  };

  const changeSelectedBlockIndent = (direction: 1 | -1) => {
    if (editor.isActive("table")) return;
    if (editor.isActive("listItem")) {
      const chain = editor.chain().focus();
      if (direction > 0) chain.sinkListItem("listItem").run();
      else chain.liftListItem("listItem").run();
      return;
    }
    const chain = editor.chain().focus();
    if (direction > 0) chain.indentBlocks().run();
    else chain.outdentBlocks().run();
  };

  const insertBlankBlockAfterCurrent = () => {
    const { doc, selection } = editor.state;
    const { $from } = selection;
    let insertPos: number;

    if ($from.depth > 0) {
      // depth=1 is always the top-level block, even when the cursor is nested
      // inside a list, quote, table cell, or another structured node.
      insertPos = $from.after(1);
    } else {
      // A NodeSelection can sit immediately before a top-level atomic block.
      // In that case insert after the selected/following node, not before it.
      const child = doc.childAfter($from.pos);
      insertPos = child.node ? $from.pos + child.node.nodeSize : doc.content.size;
    }

    editor
      .chain()
      .insertContentAt(insertPos, { type: "paragraph" })
      .focus(insertPos + 1)
      .scrollIntoView()
      .run();
    setBlockOpen(false);
  };

  const btn = (label: ReactNode, action: () => void, active?: boolean, title?: string, disabled?: boolean) => (
    <button
      className={`menu-btn ${active ? "active" : ""}`}
      onClick={disabled ? undefined : action}
      type="button"
      title={title}
      disabled={disabled}
    >
      {label}
    </button>
  );

  const handleExportMarkdown = async () => {
    const markdown = noteToMarkdown(localTitle, proseMirrorToDelta(editor.getJSON()));
    const safeTitle = (localTitle.trim() || "无标题")
      .replace(/[\\/:*?"<>|]/g, "-")
      .slice(0, 100);
    const filename = `${safeTitle}.md`;
    if (isTauri()) {
      await exportMarkdownWithDialog(markdown, filename);
      return;
    }
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const getTableCellContext = () => {
    const { state, view } = editor;
    if (state.selection instanceof CellSelection) {
      const $cell = state.selection.$headCell;
      const table = $cell.node(-1);
      if (table.type.name !== "table") return null;
      return {
        state,
        view,
        table,
        tableContentStart: $cell.start(-1),
        cellPos: $cell.pos,
        map: TableMap.get(table),
      };
    }

    const { $from } = state.selection;
    let tableDepth = $from.depth;
    while (tableDepth > 0 && $from.node(tableDepth).type.name !== "table") tableDepth--;
    let cellDepth = $from.depth;
    while (
      cellDepth > tableDepth &&
      $from.node(cellDepth).type.name !== "tableCell" &&
      $from.node(cellDepth).type.name !== "tableHeader"
    ) cellDepth--;
    if (tableDepth === 0 || cellDepth <= tableDepth) return null;

    const table = $from.node(tableDepth);
    return {
      state,
      view,
      table,
      tableContentStart: $from.start(tableDepth),
      cellPos: $from.before(cellDepth),
      map: TableMap.get(table),
    };
  };

  const setTableSelection = (kind: "row" | "column" | "table") => {
    const context = getTableCellContext();
    if (!context) return;
    const { state, view, map, tableContentStart, cellPos } = context;
    const currentCell = state.doc.resolve(cellPos);
    const nextSelection = kind === "row"
      ? CellSelection.rowSelection(currentCell)
      : kind === "column"
        ? CellSelection.colSelection(currentCell)
        : CellSelection.create(
            state.doc,
            tableContentStart + map.map[0],
            tableContentStart + map.map[map.map.length - 1],
          );
    view.dispatch(state.tr.setSelection(nextSelection));
    view.focus();
  };

  const setTableCellAlignment = (textAlign: "left" | "center" | "right") => {
    const { state, view } = editor;
    let transaction = state.tr;
    if (state.selection instanceof CellSelection) {
      state.selection.forEachCell((cell, pos) => {
        transaction = transaction.setNodeMarkup(pos, undefined, { ...cell.attrs, textAlign });
      });
    } else {
      const context = getTableCellContext();
      if (!context) return;
      const { table, tableContentStart, cellPos, map } = context;
      const column = map.findCell(cellPos - tableContentStart).left;
      for (let row = 0; row < map.height; row++) {
        const targetPos = tableContentStart + map.positionAt(row, column, table);
        const cell = transaction.doc.nodeAt(targetPos);
        if (cell) {
          transaction = transaction.setNodeMarkup(targetPos, undefined, { ...cell.attrs, textAlign });
        }
      }
    }
    view.dispatch(transaction);
    view.focus();
  };

  const copySelectedTableCells = async () => {
    const selection = editor.state.selection;
    const context = getTableCellContext();
    if (!(selection instanceof CellSelection) || !context) return;
    const { state, map, table, tableContentStart } = context;
    const rect = map.rectBetween(
      selection.$anchorCell.pos - tableContentStart,
      selection.$headCell.pos - tableContentStart,
    );
    const rows: string[] = [];
    for (let row = rect.top; row < rect.bottom; row++) {
      const cells: string[] = [];
      for (let column = rect.left; column < rect.right; column++) {
        const pos = tableContentStart + map.positionAt(row, column, table);
        cells.push(state.doc.nodeAt(pos)?.textContent ?? "");
      }
      rows.push(cells.join("\t"));
    }
    await copyToClipboard(rows.join("\n"));
  };

  const clearSelectedTableCells = () => {
    const { state, view } = editor;
    if (deleteCellSelection(state, (transaction) => view.dispatch(transaction))) {
      view.focus();
    }
  };

  const preventReadonlyTableResize = (event: React.MouseEvent) => {
    if (!readonly || !(event.target instanceof Element)) return;
    const cell = event.target.closest("td, th");
    if (!cell) return;
    const rect = cell.getBoundingClientRect();
    if (Math.abs(rect.right - event.clientX) <= 8) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const readonlyHeadingSectionAtPoint = (
    target: EventTarget | null,
    clientX: number,
    clientY: number,
  ): HeadingSection | null => {
    if (!readonly || editor.isDestroyed) return null;
    if (!(target instanceof Node) || !editor.view.dom.contains(target)) return null;
    const position = editor.view.posAtCoords({ left: clientX, top: clientY })?.pos;
    return position === undefined ? null : headingSectionAtPosition(headingSections, position);
  };

  const toggleReadonlyHeadingSection = (section: HeadingSection, clientY: number): boolean => {
    allHeadingFoldRoundTripRef.current = null;
    const heading = editor.view.nodeDOM(section.pos);
    const scrollRoot = scrollRef.current;
    const willCollapse = !getCollapsedHeadingKeys(editor).has(section.key);
    let desiredHeadingTop: number | null = null;
    if (willCollapse && heading instanceof HTMLElement && scrollRoot) {
      const headingRect = heading.getBoundingClientRect();
      const rootRect = scrollRoot.getBoundingClientRect();
      // 双击标题自身时保持原位；从章节正文触发时，把所属标题带到双击点附近。
      const requestedTop = clientY >= headingRect.top && clientY <= headingRect.bottom
        ? headingRect.top
        : clientY - headingRect.height / 2;
      desiredHeadingTop = Math.min(
        rootRect.bottom - headingRect.height - 8,
        Math.max(rootRect.top + 8, requestedTop),
      );
    }

    // 双击路径自行保持标题的视口位置，不让 ProseMirror 再围绕旧选区
    // scrollIntoView；后者在折叠长章节时会造成一次多余的同步滚动与布局。
    if (!toggleHeadingSectionFold(editor, section, false)) return false;
    if (desiredHeadingTop !== null && scrollRoot) {
      if (headingFoldViewportFrameRef.current !== null) {
        window.cancelAnimationFrame(headingFoldViewportFrameRef.current);
      }
      headingFoldViewportFrameRef.current = window.requestAnimationFrame(() => {
        headingFoldViewportFrameRef.current = null;
        if (editor.isDestroyed || !scrollRoot.isConnected) return;
        const foldedHeading = editor.view.nodeDOM(section.pos);
        if (!(foldedHeading instanceof HTMLElement)) return;
        scrollRoot.scrollTop += foldedHeading.getBoundingClientRect().top - desiredHeadingTop!;
      });
    }
    return true;
  };

  const toggleReadonlyHeadingAtPoint = (
    target: EventTarget | null,
    clientX: number,
    clientY: number,
  ): boolean => {
    const section = readonlyHeadingSectionAtPoint(target, clientX, clientY);
    return section ? toggleReadonlyHeadingSection(section, clientY) : false;
  };

  const handleReadonlyHeadingDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!readonly || !focusMode) return;
    if (performance.now() < suppressReadonlyDoubleClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!toggleReadonlyHeadingAtPoint(event.target, event.clientX, event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const handleReadonlyHeadingPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!readonly || !focusMode || event.pointerType !== "touch" || !event.isPrimary) return;
    readonlyTouchPointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  };

  const handleReadonlyHeadingPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = readonlyTouchPointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 12) {
      pointer.moved = true;
      readonlyLastTapRef.current = null;
    }
  };

  const handleReadonlyHeadingPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (readonlyTouchPointerRef.current?.pointerId === event.pointerId) {
      readonlyTouchPointerRef.current = null;
      readonlyLastTapRef.current = null;
    }
  };

  const handleReadonlyHeadingPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = readonlyTouchPointerRef.current;
    readonlyTouchPointerRef.current = null;
    if (
      !readonly
      || !focusMode
      || editor.isDestroyed
      || event.pointerType !== "touch"
      || !event.isPrimary
      || !pointer
      || pointer.pointerId !== event.pointerId
      || pointer.moved
      || Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 12
    ) return;

    const now = performance.now();
    const previous = readonlyLastTapRef.current;
    const isDoubleTap = Boolean(
      previous
      && now - previous.time <= 420
      && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 24
    );
    if (!isDoubleTap) {
      readonlyLastTapRef.current = {
        time: now,
        x: event.clientX,
        y: event.clientY,
      };
      return;
    }

    readonlyLastTapRef.current = null;
    // 与旧版原生 dblclick 一致，只在确认第二次点按后做一次命中测试。
    const section = readonlyHeadingSectionAtPoint(event.target, event.clientX, event.clientY);
    if (!section || !toggleReadonlyHeadingSection(section, event.clientY)) return;
    // 部分 WebKit 版本会在 pointer 事件后补发 dblclick，必须吞掉一次，
    // 否则章节会立即折叠后再展开，看起来像完全没有响应。
    suppressReadonlyDoubleClickUntilRef.current = now + 650;
    event.preventDefault();
    event.stopPropagation();
  };

  const moreActions = (<>
    <button className="menu-dropdown-item" onClick={() => { void handleExportMarkdown(); setMoreOpen(false); }} type="button">M↑ 导出 Markdown</button>
    <div className="menu-dropdown-sep" />
    <button className="menu-dropdown-item" onClick={() => {
      toggleCurrentBookmark();
      setMoreOpen(false);
    }} type="button">{currentBookmark ? "取消当前位置书签" : "添加当前位置书签"} <span>Ctrl+Shift+M</span></button>
    <button className="menu-dropdown-item" onClick={() => {
      setBookmarkOpen(true);
      setMoreOpen(false);
    }} type="button">书签列表{bookmarks.length > 0 ? `（${bookmarks.length}）` : ""}</button>
    <div className="menu-dropdown-sep" />
    <button className="menu-dropdown-item" onClick={() => {
      setLinkDialogUrl(editor.getAttributes("link").href || "");
      setLinkDialog(true);
      setMoreOpen(false);
    }} type="button">🔗 添加或编辑链接</button>
    <button className="menu-dropdown-item" onClick={() => { setImageDialog(true); setMoreOpen(false); }} type="button">🖼 插入图片</button>
    <label className="menu-dropdown-control">
      <span>文字字号</span>
      <select
        value={editor.getAttributes("textStyle").fontSize || ""}
        onChange={(event) => {
          if (event.target.value) (editor.chain() as any).focus().setFontSize(event.target.value).run();
          else (editor.chain() as any).focus().unsetFontSize().run();
        }}
      >
        <option value="">默认</option>
        {FONT_SIZES.map((size) => <option key={size} value={size}>{size}px</option>)}
      </select>
    </label>
    <label className="menu-dropdown-control">
      <span>文字颜色</span>
      <input
        type="color"
        value={editor.getAttributes("textStyle").color || "#333333"}
        onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
      />
    </label>
    <button className="menu-dropdown-item" onClick={() => editor.chain().focus().unsetColor().run()} type="button">清除文字颜色</button>
    <div className="menu-dropdown-sep" />
    <button className="menu-dropdown-item" disabled={editorFontSize <= 12} onClick={() => onEditorFontSizeChange(Math.max(12, editorFontSize - 1))} type="button">缩小编辑器字号</button>
    <button className="menu-dropdown-item" disabled={editorFontSize >= 32} onClick={() => onEditorFontSizeChange(Math.min(32, editorFontSize + 1))} type="button">放大编辑器字号</button>
  </>);

  return (
    <div
      className={`note-editor ${readonly ? "note-editor-readonly" : ""} ${cjkLatinSpacing ? "editor-auto-cjk-spacing" : ""} ${cjkLatinSpacing && !nativeCjkLatinSpacing ? "editor-cjk-spacing-fallback" : ""} ${showLineNumbers ? "show-line-numbers" : ""} ${focusMode ? "focus-mode" : ""} ${focusToolbarExpanded ? "focus-toolbar-expanded" : ""} ${!highlightActiveLine ? "no-active-line" : ""} ${showCodeLineNumbers ? "show-code-line-numbers" : ""} ${outlineDock !== "floating" ? `outline-docked-${outlineDock}` : ""} ${outlineOpen ? "outline-docked-open" : ""}`}
      style={{ "--note-outline-docked-width": `${outlineDockWidth}px` } as React.CSSProperties}
      onPasteCapture={handlePaste}
      onDrop={handleDrop}
      onMouseDownCapture={preventReadonlyTableResize}
    >
      {focusMode && (
        <div className="mobile-focus-bar" aria-label="专注模式工具栏">
          <span className="mobile-focus-title" title={localTitle || "无标题"}>{localTitle || "无标题"}</span>
          {documentOutline.length > 0 && (
            <button
              type="button"
              aria-expanded={outlineOpen}
              onClick={(event) => {
                event.stopPropagation();
                setFocusToolbarExpanded(false);
                toggleDocumentOutline();
              }}
              title="文档目录"
            >目录</button>
          )}
          <button type="button" onClick={() => onFocusModeChange?.(false)} title="退出专注模式">退出</button>
          {!readonly && (
            <button
              type="button"
              aria-expanded={focusToolbarExpanded}
              onClick={() => {
                setOutlineOpen(false);
                setFocusToolbarExpanded((expanded) => !expanded);
              }}
              title="更多编辑工具"
            >更多</button>
          )}
        </div>
      )}
      {editorFindOpen && (
        <div className="editor-find-bar" role="search" onClick={(event) => event.stopPropagation()}>
          <input
            ref={editorFindInputRef}
            value={editorFindQuery}
            onChange={(event) => setEditorFindQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                navigateEditorFind(event.shiftKey ? -1 : 1);
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeEditorFind();
                editor.commands.focus();
              }
            }}
            placeholder="在当前文档中查找"
            aria-label="在当前文档中查找"
          />
          <span className="editor-find-count" aria-live="polite">
            {editorFindQuery.trim() ? (searchMatches.length > 0 ? `${activeSearchMatch + 1}/${searchMatches.length}` : "0/0") : ""}
          </span>
          <button type="button" onClick={() => navigateEditorFind(-1)} disabled={searchMatches.length === 0} title="上一处匹配" aria-label="上一处匹配">↑</button>
          <button type="button" onClick={() => navigateEditorFind(1)} disabled={searchMatches.length === 0} title="下一处匹配" aria-label="下一处匹配">↓</button>
          <button type="button" onClick={() => { closeEditorFind(); editor.commands.focus(); }} title="关闭查找" aria-label="关闭查找">×</button>
        </div>
      )}
      {lineJumpOpen && (
        <div className="editor-line-jump" role="dialog" aria-label="跳转行号" onClick={(event) => event.stopPropagation()}>
          <label htmlFor={`line-jump-${noteId}`}>行号</label>
          <input
            ref={lineJumpInputRef}
            id={`line-jump-${noteId}`}
            value={lineJumpValue}
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="跳转到行号"
            aria-invalid={lineJumpError ? "true" : "false"}
            onChange={(event) => {
              setLineJumpValue(event.target.value);
              setLineJumpError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitLineJump();
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeLineJump();
                editor.commands.focus();
              }
            }}
          />
          <span className={lineJumpError ? "editor-line-jump-error" : "editor-line-jump-range"} role="status">
            {lineJumpError ?? `/ ${Math.max(gutterBlockCount, editor.state.doc.childCount)}`}
          </span>
          <button type="button" onClick={submitLineJump} title="跳转" aria-label="跳转">↵</button>
          <button type="button" onClick={() => { closeLineJump(); editor.commands.focus(); }} title="关闭跳转" aria-label="关闭跳转">×</button>
        </div>
      )}
      {outlineOpen && documentOutline.length > 0 && (
        <nav
          className="document-outline-panel"
          style={outlineDock === "floating" ? undefined : ({ width: `var(--note-outline-docked-width, ${DEFAULT_OUTLINE_DOCK_WIDTH}px)` } as React.CSSProperties)}
          aria-label="文档目录"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="document-outline-header">
            <div className="document-outline-header-primary">
              <span>目录</span>
              <button
                type="button"
                onClick={() => {
                  setAllOutlineFolds(true);
                  setAllHeadingFoldsKeepingViewport(true);
                }}
                title="折叠全部章节"
              >全部折叠</button>
              <button
                type="button"
                onClick={() => {
                  setAllOutlineFolds(false);
                  setAllHeadingFoldsKeepingViewport(false);
                }}
                title="展开全部章节"
              >全部展开</button>
            </div>
            <div className="document-outline-header-actions">
              <div
                className={`document-outline-jumps ${outlineOverflow ? "" : "is-placeholder"}`}
                aria-label="目录快速滚动"
                aria-hidden={!outlineOverflow}
              >
                <button type="button" onClick={() => scrollOutlineTo("top")} title="滚动至顶部">Top</button>
                <button type="button" onClick={() => scrollOutlineTo("middle")} title="滚动至中部">Mid</button>
                <button type="button" onClick={() => scrollOutlineTo("bottom")} title="滚动至底部">Bot</button>
              </div>
              <span className="document-outline-count">
                {visibleOutlineEntries.length === documentOutline.length
                  ? `${documentOutline.length} 项`
                  : `${visibleOutlineEntries.length}/${documentOutline.length} 项`}
              </span>
              <button type="button" className={outlineDock === "left" ? "active" : ""} onClick={() => setDocumentOutlineDock("left")} title="固定目录到左侧">⇤</button>
              {outlineDock !== "floating" && (
                <button type="button" onClick={() => setDocumentOutlineDock("floating")} title="取消固定目录">↔</button>
              )}
              <button type="button" className={outlineDock === "right" ? "active" : ""} onClick={() => setDocumentOutlineDock("right")} title="固定目录到右侧">⇥</button>
            </div>
          </div>
          {outlineDock !== "floating" && (
            <span
              className={`document-outline-resize-handle ${outlineDock === "left" ? "right" : "left"}`}
              onPointerDown={(event) => startOutlineResize(event, outlineDock === "left" ? "right" : "left")}
            />
          )}
          <DocumentOutlineList
            entries={visibleOutlineEntries}
            activeOutlineIndex={activeOutlineIndex}
            outlineBaseLevel={outlineBaseLevel}
            listRef={outlineListRef}
            onToggleFold={toggleOutlineTreeHeading}
            onJump={jumpToOutlineHeading}
          />
        </nav>
      )}
      {bookmarkOpen && (
        <nav
          className="document-bookmark-panel"
          aria-label="文档书签"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="document-bookmark-header">
            <span>书签</span>
            <span>{bookmarks.length} 项</span>
          </div>
          <div className="document-bookmark-list">
            {bookmarks.length === 0 ? (
              <div className="document-bookmark-empty">当前文档还没有书签</div>
            ) : bookmarks.map((bookmark, index) => (
              <div className="document-bookmark-item" key={bookmark.id}>
                <button
                  className="document-bookmark-jump"
                  type="button"
                  onClick={() => jumpToBookmark(bookmark)}
                  title={bookmark.preview}
                >
                  <span className="document-bookmark-index">{bookmark.key ? `'${bookmark.key}` : index + 1}</span>
                  <span>{bookmark.label || bookmark.preview}</span>
                </button>
                {!readonly && <button type="button" onClick={() => editBookmarkLabel(bookmark)} title="重命名书签">✎</button>}
                {!readonly && <button type="button" onClick={() => removeBookmark(editor, bookmark.id)} title="删除书签">×</button>}
              </div>
            ))}
          </div>
          {!readonly && (
            <button
              className="document-bookmark-add"
              type="button"
              onClick={toggleCurrentBookmark}
            >{currentBookmark ? "取消当前位置书签" : "添加当前位置书签"}</button>
          )}
        </nav>
      )}
      {/* ── 标题 + 标签 + 工具栏 + 编辑器（滚动区域）── */}
      <div className="note-editor-scroll" ref={scrollRef}>
        <div className="note-editor-sticky">
          {/* ── 标题 ── */}
        <div className="note-title-row" ref={titleRef}>
          {readonly && (onReadonlyChange ? (
            <button
              type="button"
              className="note-readonly-badge note-readonly-action"
              onClick={async () => {
                await onReadonlyChange(false);
                setReadonlyChangeNotice(true);
              }}
              title="点击设为可编辑"
              aria-label="点击设为可编辑"
            >
              <span aria-hidden="true">🔒</span>
            </button>
          ) : (
            <span className="note-readonly-badge" title="只读">🔒</span>
          ))}
          <input
            ref={titleInputRef}
            type="text"
            className="note-title"
            placeholder="随心记 — 标题"
            value={localTitle}
            onChange={(e) => { setLocalTitle(e.target.value); onTitleChange(e.target.value); }}
            readOnly={readonly}
          />
          {documentOutline.length > 0 && (
            <div className="document-outline-control">
              <button
                className={`focus-btn document-outline-toggle ${outlineOpen ? "active" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleDocumentOutline();
                }}
                title="文档目录"
                aria-label="文档目录"
                aria-expanded={outlineOpen}
                type="button"
              >目录</button>
            </div>
          )}
          <button
            className={`focus-btn document-bookmark-toggle ${bookmarkOpen ? "active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              setOutlineOpen(false);
              setBookmarkOpen((open) => !open);
            }}
            title={bookmarks.length > 0 ? `文档书签（${bookmarks.length}）` : "添加书签"}
            aria-label="文档书签"
            aria-expanded={bookmarkOpen}
            type="button"
          >书签{bookmarks.length > 0 ? ` ${bookmarks.length}` : ""}</button>
          <button
            className={`focus-btn ${focusMode ? "active" : ""}`}
            onClick={() => { onFocusModeChange?.(!focusMode); }}
            title={focusMode ? "退出专注模式" : "专注模式"}
            type="button"
          >
            {focusMode ? "⊞" : "⊟"}
          </button>
        </div>
        {/* ── 标签区 ── */}
        <div className="tag-bar">
          {tags.map((t) => (
            <span key={t} className="tag-chip">
              {t}
              {!readonly && <button className="tag-chip-remove" onClick={() => removeTag(t)}>×</button>}
            </span>
          ))}
          {!readonly && <input
            className="tag-input"
            placeholder={tags.length === 0 ? "添加标签..." : ""}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            onBlur={() => {
              if (tagInput.trim()) {
                addTag(tagInput);
                setTagInput("");
              }
            }}
          />}
        </div>

        {/* ── 工具栏 ── */}
        {!readonly && (<div
          ref={toolbarRef}
          className={`editor-menu ${isNarrow ? "toolbar-compact" : "toolbar-full"} ${isMinimalToolbar ? "toolbar-minimal" : ""}`}
          onPointerDownCapture={(event) => {
            if (!(event.target instanceof Element) || !event.target.closest("button")) return;
            toolbarInteractingRef.current = true;
            // The first tap may move DOM focus away from the editor. Keep the last non-empty
            // selection across opening a dropdown and tapping one of its commands.
            rememberToolbarSelection();
          }}
          onTouchStartCapture={(event) => {
            if (!(event.target instanceof Element) || !event.target.closest("button")) return;
            toolbarInteractingRef.current = true;
            rememberToolbarSelection();
            event.preventDefault();
          }}
          onTouchEndCapture={(event) => {
            if (!(event.target instanceof Element)) return;
            const button = event.target.closest<HTMLButtonElement>("button");
            if (!button) return;
            event.preventDefault();
            button.click();
          }}
          onClickCapture={(event) => {
            if (!(event.target instanceof Element) || !event.target.closest("button")) return;
            const cellSelection = toolbarCellSelectionRef.current;
            const textSelection = toolbarSelectionRef.current;
            if (cellSelection) {
              editor.view.dispatch(editor.state.tr.setSelection(cellSelection));
            } else if (textSelection) {
              editor.commands.setTextSelection(textSelection);
            }
            requestAnimationFrame(() => { toolbarInteractingRef.current = false; });
          }}
        >
          {btn("↩", () => editor.chain().focus().undo().run(), false, "撤销 (Ctrl+Z)", readonly)}
          {btn("↪", () => editor.chain().focus().redo().run(), false, "重做 (Ctrl+Y)", readonly)}
          <span className="menu-sep" />
          {isNarrow ? (
            <div className="menu-dropdown">
              <button
                className="menu-btn"
                onClick={(e) => { e.stopPropagation(); toggleMobileToolbarMenu("style", styleOpen); }}
                type="button"
                title="样式"
              >
                {editor.isActive("bold") ? "B" :
                 editor.isActive("italic") ? "I" :
                 editor.isActive("strike") ? "S" : "样式 ▾"}
              </button>
              {styleOpen && (
                <div className="menu-dropdown-list">
                  <button
                    className={`menu-dropdown-item ${editor.isActive("bold") ? "active" : ""}`}
                    onClick={() => { runToolbarFormat("bold"); setStyleOpen(false); }}
                    type="button"
                  ><b>B 加粗</b></button>
                  <button
                    className={`menu-dropdown-item ${editor.isActive("italic") ? "active" : ""}`}
                    onClick={() => { runToolbarFormat("italic"); setStyleOpen(false); }}
                    type="button"
                  ><i>I 斜体</i></button>
                  <button
                    className={`menu-dropdown-item ${editor.isActive("strike") ? "active" : ""}`}
                    onClick={() => { runToolbarFormat("strike"); setStyleOpen(false); }}
                    type="button"
                  ><s>S 删除线</s></button>
                </div>
              )}
            </div>
          ) : (<>
          {btn(<b>B</b>, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"), "加粗 (Ctrl+B)", readonly)}
          {btn(<i>I</i>, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"), "斜体 (Ctrl+I)", readonly)}
          {btn(<s>S</s>, () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"), "删除线 (Ctrl+Shift+X)", readonly)}
          </>)}
          <span className="menu-sep" />
          {isNarrow ? (
            <div className="menu-dropdown">
              <button
                className="menu-btn"
                onClick={(e) => { e.stopPropagation(); toggleMobileToolbarMenu("heading", headingOpen); }}
                type="button"
                title="标题"
              >
                {editor.isActive("heading", { level: 1 }) ? "H1" :
                 editor.isActive("heading", { level: 2 }) ? "H2" :
                 editor.isActive("heading", { level: 6 }) ? "H6" :
                 editor.isActive("heading", { level: 3 }) ? "H3" :
                 editor.isActive("heading", { level: 4 }) ? "H4" :
                 editor.isActive("heading", { level: 5 }) ? "H5" : "标题 ▾"}
              </button>
              {headingOpen && (
                <div className="menu-dropdown-list">
                  {(headingPage === 0 ? [3, 4, 5] : [1, 2, 6]).map((lvl) => (
                    <button
                      key={lvl}
                      className={`menu-dropdown-item ${editor.isActive("heading", { level: lvl }) ? "active" : ""}`}
                      onClick={() => { editor.chain().focus().toggleHeading({ level: lvl as any }).run(); setHeadingOpen(false); }}
                      type="button"
                    >H{lvl} — {["","大标题","中标题","小标题","子标题","细标题","微标题"][lvl]}</button>
                  ))}
                  <div className="menu-dropdown-sep" />
                  <button
                    className="menu-dropdown-item"
                    onClick={() => { editor.chain().focus().clearNodes().run(); setHeadingOpen(false); }}
                    type="button"
                  >清除标题</button>
                  <div className="menu-dropdown-sep" />
                  <button
                    className="menu-dropdown-item menu-dropdown-toggle"
                    onClick={(e) => { e.stopPropagation(); setHeadingPage(headingPage === 0 ? 1 : 0); }}
                    type="button"
                    title="切换 H3–5 / H1–2 H6"
                  >
                    {headingPage === 0 ? "▶ H1–2 H6" : "◀ H3–H5"}
                  </button>
                </div>
              )}
            </div>
          ) : (<>
          {(headingPage === 0 ? [3, 4, 5] : [1, 2, 6]).map((lvl) => (
            <React.Fragment key={lvl}>
              {btn(`H${lvl}`, () => editor.chain().focus().toggleHeading({ level: lvl as any }).run(), editor.isActive("heading", { level: lvl }), `标题 ${lvl}`, readonly)}
            </React.Fragment>
          ))}
          <button
            className="menu-btn menu-btn-sm"
            onClick={() => setHeadingPage(headingPage === 0 ? 1 : 0)}
            title={headingPage === 0 ? "H1–2 H6" : "H3–H5"}
            type="button"
          >{headingPage === 0 ? "»" : "«"}</button>
          </>)}
          <span className="menu-sep" />
          {isNarrow ? (
            <div className="menu-dropdown">
              <button
                className="menu-btn"
                onClick={(e) => { e.stopPropagation(); toggleMobileToolbarMenu("block", blockOpen); }}
                type="button"
                title="块"
              >块 ▾</button>
              {blockOpen && (
                <div className="menu-dropdown-list">
                  <button
                    className={`menu-dropdown-item ${editor.isActive("blockquote") ? "active" : ""}`}
                    onClick={() => { editor.chain().focus().toggleBlockquote().run(); setBlockOpen(false); }}
                    type="button"
                  >❝ 引用</button>
                  <button
                    className={`menu-dropdown-item ${editor.isActive("bulletList") ? "active" : ""}`}
                    onClick={() => { editor.chain().focus().toggleBulletList().run(); setBlockOpen(false); }}
                    type="button"
                  >• 无序列表</button>
                  <button
                    className={`menu-dropdown-item ${editor.isActive("orderedList") ? "active" : ""}`}
                    onClick={() => { editor.chain().focus().toggleOrderedList().run(); setBlockOpen(false); }}
                    type="button"
                  >1. 有序列表</button>
                  <button
                    className="menu-dropdown-item"
                    onClick={() => { changeSelectedBlockIndent(1); setBlockOpen(false); }}
                    disabled={editor.isActive("table")}
                    type="button"
                  >→ 增加块缩进（Tab）</button>
                  <button
                    className="menu-dropdown-item"
                    onClick={() => { changeSelectedBlockIndent(-1); setBlockOpen(false); }}
                    disabled={editor.isActive("table")}
                    type="button"
                  >← 减少块缩进（Shift+Tab）</button>
                  <button
                    className={`menu-dropdown-item ${editor.isActive("codeBlock") ? "active" : ""}`}
                    onClick={handleToggleCodeBlock}
                    type="button"
                  >⏹ 代码块</button>
                  {(editor.isActive("codeBlock") || editor.isActive("blockquote")) && (
                    <button
                      className="menu-dropdown-item"
                      onClick={() => { exitCurrentStructuredBlock(editor); setBlockOpen(false); }}
                      type="button"
                    >↵ 退出当前块（Ctrl+Enter）</button>
                  )}
                  {isMobileToolbarViewport && (
                    <button
                      className="menu-dropdown-item"
                      onClick={insertBlankBlockAfterCurrent}
                      disabled={readonly}
                      type="button"
                    >＋ 在当前块后插入空白块</button>
                  )}
                  <button
                    className="menu-dropdown-item"
                    onClick={() => {
                      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
                      setBlockOpen(false);
                    }}
                    disabled={editor.isActive("table")}
                    type="button"
                  >▦ 插入表格</button>
                  <div className="menu-dropdown-sep" />
                  <button
                    className="menu-dropdown-item"
                    disabled={!hasSelection()}
                    onClick={convertSelectionFromMarkdown}
                    type="button"
                  >M↓ 转换所选 Markdown</button>
                  <div className="menu-dropdown-sep" />
                  <button
                    className={`menu-dropdown-item ${showCodeLineNumbers ? "active" : ""}`}
                    onClick={() => {
                      const next = !showCodeLineNumbers;
                      setShowCodeLineNumbers(next);
                      localStorage.setItem(CODE_LN_KEY, String(next));
                      setBlockOpen(false);
                    }}
                    type="button"
                  >{showCodeLineNumbers ? "▣ 隐藏代码行号" : "□ 显示代码行号"}</button>
                </div>
              )}
            </div>
          ) : (<>
          {btn("❝", () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"), "引用 (Ctrl+Shift+B)", readonly)}
          {btn("•", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"), "无序列表 (Ctrl+Shift+8)", readonly)}
          {btn("1.", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"), "有序列表 (Ctrl+Shift+7)", readonly)}
          {btn("→", () => changeSelectedBlockIndent(1), false, "增加块缩进 (Tab)", readonly || editor.isActive("table"))}
          {btn("←", () => changeSelectedBlockIndent(-1), false, "减少块缩进 (Shift+Tab)", readonly || editor.isActive("table"))}
          {btn("⏹", handleToggleCodeBlock, editor.isActive("codeBlock"), "代码块 (Ctrl+Alt+C)", readonly)}
          {btn("▦", () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), editor.isActive("table"), "插入 3×3 表格", readonly || editor.isActive("table"))}
          {btn("M↓", convertSelectionFromMarkdown, false, "转换所选 Markdown", readonly || !hasSelection())}
          <button
            className={`menu-btn ${showCodeLineNumbers ? "active" : ""}`}
            onClick={() => {
              const next = !showCodeLineNumbers;
              setShowCodeLineNumbers(next);
              localStorage.setItem(CODE_LN_KEY, String(next));
            }}
            title={showCodeLineNumbers ? "隐藏代码行号" : "显示代码行号"}
            type="button"
          >#</button>
          </>)}
          {editor.isActive("table") && (
            <div className="menu-dropdown toolbar-table-menu">
              <button
                className="menu-btn active"
                onClick={(e) => { e.stopPropagation(); toggleMobileToolbarMenu("table", tableOpen); }}
                type="button"
                title="表格操作"
              >▦ 表格 ▾</button>
              {tableOpen && (
                <div className="menu-dropdown-list table-context-menu">
                  <div className="table-selection-hint">
                    {selectedTableCellCount > 0
                      ? `已选择 ${selectedTableCellCount} 个单元格`
                      : "拖动可连续选择；触屏可选择整行或整列"}
                  </div>
                  <button className="menu-dropdown-item" onClick={() => { setTableSelection("row"); setTableOpen(false); }} type="button">选择当前行</button>
                  <button className="menu-dropdown-item" onClick={() => { setTableSelection("column"); setTableOpen(false); }} type="button">选择当前列</button>
                  <button className="menu-dropdown-item" onClick={() => { setTableSelection("table"); setTableOpen(false); }} type="button">选择整个表格</button>
                  {selectedTableCellCount > 0 && (
                    <>
                      <button className="menu-dropdown-item" onClick={() => { void copySelectedTableCells(); setTableOpen(false); }} type="button">复制所选单元格</button>
                      <button className="menu-dropdown-item" onClick={() => { clearSelectedTableCells(); setTableOpen(false); }} type="button">清空所选单元格</button>
                    </>
                  )}
                  <div className="menu-dropdown-sep" />
                  <button className="menu-dropdown-item" onClick={() => { editor.chain().focus().addRowBefore().run(); setTableOpen(false); }} type="button">在上方添加行</button>
                  <button className="menu-dropdown-item" onClick={() => { editor.chain().focus().addRowAfter().run(); setTableOpen(false); }} type="button">在下方添加行</button>
                  <button className="menu-dropdown-item" onClick={() => { editor.chain().focus().addColumnBefore().run(); setTableOpen(false); }} type="button">在左侧添加列</button>
                  <button className="menu-dropdown-item" onClick={() => { editor.chain().focus().addColumnAfter().run(); setTableOpen(false); }} type="button">在右侧添加列</button>
                  <div className="menu-dropdown-sep" />
                  <button className="menu-dropdown-item" onClick={() => { setTableCellAlignment("left"); setTableOpen(false); }} type="button">{selectedTableCellCount > 0 ? "所选单元格左对齐" : "当前列左对齐"}</button>
                  <button className="menu-dropdown-item" onClick={() => { setTableCellAlignment("center"); setTableOpen(false); }} type="button">{selectedTableCellCount > 0 ? "所选单元格居中" : "当前列居中"}</button>
                  <button className="menu-dropdown-item" onClick={() => { setTableCellAlignment("right"); setTableOpen(false); }} type="button">{selectedTableCellCount > 0 ? "所选单元格右对齐" : "当前列右对齐"}</button>
                  <div className="menu-dropdown-sep" />
                  <button className="menu-dropdown-item" onClick={() => { editor.chain().focus().deleteRow().run(); setTableOpen(false); }} type="button">{selectedTableCellCount > 0 ? "删除所选行" : "删除当前行"}</button>
                  <button className="menu-dropdown-item" onClick={() => { editor.chain().focus().deleteColumn().run(); setTableOpen(false); }} type="button">{selectedTableCellCount > 0 ? "删除所选列" : "删除当前列"}</button>
                  <button className="menu-dropdown-item danger" onClick={() => { editor.chain().focus().deleteTable().run(); setTableOpen(false); }} type="button">删除表格</button>
                </div>
              )}
            </div>
          )}
          <span className="menu-sep" />
          <div className="toolbar-secondary">
          {isNarrow ? (
            <div className="menu-dropdown">
              <button
                className="menu-btn"
                onClick={(e) => { e.stopPropagation(); toggleMobileToolbarMenu("clip", clipOpen); }}
                type="button"
                title="剪贴"
              >剪贴 ▾</button>
              {clipOpen && (
                <div className="menu-dropdown-list">
                  <button className="menu-dropdown-item" onClick={() => { handleCopy(); setClipOpen(false); }} type="button">📋 复制</button>
                  <button className="menu-dropdown-item" onClick={() => { handleCut(); setClipOpen(false); }} type="button">✂ 剪切</button>
                  <button className="menu-dropdown-item" onClick={() => { handleClipboardPaste(); setClipOpen(false); }} type="button">📝 粘贴</button>
                  <button className="menu-dropdown-item" onClick={() => { void handleExportMarkdown(); setClipOpen(false); }} type="button">M↑ 导出 Markdown</button>
                </div>
              )}
            </div>
          ) : (<>
          {btn("📋", handleCopy, false, "复制 (Ctrl+C)", readonly)}
          {btn("✂", handleCut, false, "剪切 (Ctrl+X)", readonly)}
          {btn("📝", handleClipboardPaste, false, "粘贴 (Ctrl+V)", readonly)}
          {btn("M↑", () => { void handleExportMarkdown(); }, false, "导出 Markdown", false)}
          </>)}
          <span className="menu-sep" />

          {/* 超链接 */}
          {isNarrow ? (
            <div className="menu-dropdown">
              <button
                className={`menu-btn ${editor.isActive("link") ? "active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (readonly) return;
                  const attrs = editor.getAttributes("link");
                  setLinkUrl(attrs.href || "");
                  toggleMobileToolbarMenu("link", linkOpen);
                }}
                type="button"
                title="超链接"
                disabled={readonly}
              >🔗</button>
              {linkOpen && (
                <div className="menu-dropdown-list">
                  <div style={{ padding: "6px 8px", display: "flex", gap: 4, alignItems: "center" }}>
                    <input
                      className="doc-tree-rename-input"
                      style={{ flex: 1, fontSize: 12 }}
                      placeholder="https://..."
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (linkUrl.trim()) editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
                          else editor.chain().focus().unsetLink().run();
                          setLinkOpen(false);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                    <button
                      className="menu-btn menu-btn-sm"
                      onClick={() => {
                        if (linkUrl.trim()) editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
                        else editor.chain().focus().unsetLink().run();
                        setLinkOpen(false);
                      }}
                      type="button"
                    >✓</button>
                  </div>
                  {editor.isActive("link") && (
                    <button
                      className="menu-dropdown-item"
                      onClick={() => { editor.chain().focus().unsetLink().run(); setLinkOpen(false); }}
                      type="button"
                    >移除链接</button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="menu-dropdown" style={{ position: "relative" }}>
              <button
                className={`menu-btn ${editor.isActive("link") ? "active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (readonly) return;
                  const attrs = editor.getAttributes("link");
                  setLinkUrl(attrs.href || "");
                  setLinkOpen(!linkOpen);
                }}
                type="button"
                title={editor.isActive("link") ? "编辑/移除链接" : "添加超链接 (Ctrl+K)"}
                disabled={readonly}
              >🔗</button>
              {linkOpen && (
                <div className="menu-dropdown-list" style={{ minWidth: 260 }}>
                  <div style={{ padding: "6px 8px", display: "flex", gap: 4, alignItems: "center" }}>
                    <input
                      className="doc-tree-rename-input"
                      style={{ flex: 1, fontSize: 12 }}
                      placeholder="https://..."
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (linkUrl.trim()) editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
                          else editor.chain().focus().unsetLink().run();
                          setLinkOpen(false);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                    <button
                      className="menu-btn menu-btn-sm"
                      onClick={() => {
                        if (linkUrl.trim()) editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
                        else editor.chain().focus().unsetLink().run();
                        setLinkOpen(false);
                      }}
                      type="button"
                    >✓</button>
                  </div>
                  {editor.isActive("link") && (
                    <button
                      className="menu-dropdown-item"
                      onClick={() => { editor.chain().focus().unsetLink().run(); setLinkOpen(false); }}
                      type="button"
                    >移除链接</button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 分隔后右区：字号 / 颜色 / 图片 */}
          <div className="menu-dropdown">
            <button className="menu-btn" onClick={(e) => { e.stopPropagation(); if (!readonly) toggleMobileToolbarMenu("size", sizeOpen); }} type="button" title="字号" disabled={readonly}>
              {editor.getAttributes("textStyle").fontSize || "字号"}
            </button>
            {sizeOpen && (
              <div className="menu-dropdown-list">
                {FONT_SIZES.map((s) => (
                  <button
                    key={s}
                    className={`menu-dropdown-item ${editor.getAttributes("textStyle").fontSize === String(s) ? "active" : ""}`}
                    onClick={() => {
                      (editor.chain() as any).focus().setFontSize(String(s)).run();
                      setSizeOpen(false);
                    }}
                    type="button"
                  >
                    {s}px
                  </button>
                ))}
                <div className="menu-dropdown-sep" />
                <button
                  className="menu-dropdown-item"
                  onClick={() => {
                    (editor.chain() as any).focus().unsetFontSize().run();
                    setSizeOpen(false);
                  }}
                  type="button"
                >
                  清除
                </button>
              </div>
            )}
          </div>

          {/* 文字颜色 */}
          <div className="menu-dropdown">
            <button
              className="menu-btn"
              onClick={(e) => { e.stopPropagation(); if (!readonly) toggleMobileToolbarMenu("color", colorOpen); }}
              type="button"
              title="文字颜色"
              disabled={readonly}
              style={{ color: editor.getAttributes("textStyle").color || "inherit" }}
            >
              <span className="color-preview" style={{ backgroundColor: editor.getAttributes("textStyle").color || "var(--text)" }} />
              A
            </button>
            {colorOpen && (
              <div className="menu-dropdown-list color-grid">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`color-swatch ${editor.getAttributes("textStyle").color === c ? "active" : ""}`}
                    style={{ backgroundColor: c }}
                    onClick={() => {
                      editor.chain().focus().setColor(c).run();
                      setColorOpen(false);
                    }}
                    title={c}
                    type="button"
                  />
                ))}
                <div className="menu-dropdown-sep" />
                <button
                  className="menu-dropdown-item"
                  onClick={() => {
                    editor.chain().focus().unsetColor().run();
                    setColorOpen(false);
                  }}
                  type="button"
                >
                  清除颜色
                </button>
              </div>
            )}
          </div>

          {/* 图片 */}
          <button
            className="menu-btn"
            onClick={() => { if (!readonly) setImageDialog(true); }}
            type="button"
            title="插入图片"
            disabled={readonly}
          >
            🖼
          </button>
          <span className="menu-sep" />
          {btn("A⁻", () => onEditorFontSizeChange(Math.max(12, editorFontSize - 1)), false, "缩小字号", editorFontSize <= 12)}
          <span className="menu-font-size-label">{editorFontSize}</span>
          {btn("A⁺", () => onEditorFontSizeChange(Math.min(32, editorFontSize + 1)), false, "放大字号", editorFontSize >= 32)}
          </div>
          {isMinimalToolbar && (
            <div className="menu-dropdown toolbar-more-menu">
              <button
                ref={moreButtonRef}
                className="menu-btn"
                onClick={(e) => { e.stopPropagation(); toggleMobileToolbarMenu("more", moreOpen); }}
                type="button"
                title="更多编辑操作"
              >更多 ⋯</button>
              {moreOpen && (isMobileToolbarViewport ? (
                <MobileActionSheet
                  open
                  title="更多编辑操作"
                  onClose={closeMore}
                  dismissAnchor={moreButtonRef.current}
                  className="toolbar-more-sheet"
                >
                  {moreActions}
                </MobileActionSheet>
              ) : (
                <div className="menu-dropdown-list toolbar-more-list" onClick={(event) => event.stopPropagation()}>
                  {moreActions}
                </div>
              ))}
            </div>
          )}
          {saveStatus && saveStatus !== "clean" && (
            <span className={`save-status save-status-${saveStatus}`} title={
              saveStatus === "dirty" ? "未保存" :
              saveStatus === "saving" ? "保存中..." :
              saveStatus === "saved" ? "已保存" :
              saveStatus === "error" ? "保存失败" : ""
            }>
              {saveStatus === "saving" ? "⏳" :
               saveStatus === "saved" ? "✓" :
               saveStatus === "error" ? "⚠" : "●"}
            </span>
          )}
        </div>
        )}
        </div>

        {/* ── 编辑器内容 ── */}
        {markdownPasteText && (
          <div className="markdown-paste-notice" role="status">
            <span>已按 Markdown 格式化</span>
            <button type="button" onClick={() => { editor.chain().focus().undo().run(); setMarkdownPasteText(null); }}>撤销</button>
            <button type="button" onClick={() => {
              const blocks = markdownPasteText.split(/\r?\n/).map((line) => ({
                type: "paragraph",
                ...(line ? { content: [{ type: "text", text: line }] } : {}),
              }));
              editor.chain().focus().undo().run();
              editor.chain().focus().insertContent(blocks).run();
              setMarkdownPasteText(null);
            }}>改为纯文本</button>
          </div>
        )}
        {markdownSelectionNotice && (
          <div className="markdown-paste-notice" role="status">
            <span>已转换所选 Markdown</span>
            <button type="button" onClick={() => { editor.chain().focus().undo().run(); setMarkdownSelectionNotice(false); }}>撤销</button>
          </div>
        )}
        {readonlyChangeNotice && (
          <div className="markdown-paste-notice readonly-change-notice" role="status">
            <span>已设置为可编辑</span>
          </div>
        )}
        <div
          className="editor-content-shell"
          style={{ "--editor-gutter-width": `${editorGutterWidth(gutterBlockCount, showLineNumbers, isMobileToolbarViewport)}px` } as React.CSSProperties}
        >
          <EditorBlockGutter
            editor={editor}
            showNumbers={showLineNumbers}
            showInsertButtons={!isMobileToolbarViewport}
            readonly={!!readonly}
            onBlockCountChange={setGutterBlockCount}
            onHeadingFoldToggle={toggleEditorHeadingFromGutter}
          />
          <EditorContent
            editor={editor}
            className="editor-content"
            onDoubleClick={handleReadonlyHeadingDoubleClick}
            onPointerDown={handleReadonlyHeadingPointerDown}
            onPointerMove={handleReadonlyHeadingPointerMove}
            onPointerCancel={handleReadonlyHeadingPointerCancel}
            onPointerUp={handleReadonlyHeadingPointerUp}
            onClick={() => {
              if (readonly && vimModeEnabled) {
                editor.view.dom.focus({ preventScroll: true });
              }
            }}
            onContextMenu={handleEditorContextMenu}
          />
        </div>

        {/* ── [[ 双向链接下拉 ── */}
        {wikiOpen && (
          <div
            className="wiki-dropdown"
            style={{ top: wikiPos.top, left: wikiPos.left }}
          >
            {wikiSuggestions.length === 0 ? (
              <div className="wiki-empty">无匹配笔记</div>
            ) : (
              wikiSuggestions.map((n) => (
                <div
                  key={n.id}
                  className="wiki-item"
                  onClick={() => selectWikiLink(n)}
                >
                  <span className="wiki-title">{n.title}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── 底部信息栏（位置 + 字数 + 版本历史）─ */}
      {(showStatusBar || searchMatches.length > 0) && <div className={`editor-stats${showStatusBar ? "" : " editor-stats-search-only"}`}>
        {searchMatches.length > 0 && !editorFindOpen && (
          <span className="editor-search-navigation" role="status" aria-live="polite">
            <span>{activeSearchMatch + 1} / {searchMatches.length}</span>
            <button type="button" onClick={() => revealSearchMatch(activeSearchMatch - 1)} title="上一处匹配" aria-label="上一处匹配">↑</button>
            <button type="button" onClick={() => revealSearchMatch(activeSearchMatch + 1)} title="下一处匹配" aria-label="下一处匹配">↓</button>
            <button
              type="button"
              onClick={() => {
                searchMatchesRef.current = [];
                setSearchMatches([]);
                setSearchHighlights(editor, [], 0);
              }}
              title="关闭搜索高亮"
              aria-label="关闭搜索高亮"
            >×</button>
          </span>
        )}
        {vimModeEnabled && (
          <>
            <span className={`editor-vim-status vim-${vimEditorMode}`}>{VIM_MODE_LABELS[vimEditorMode]}</span>
            <span className="stat-sep">|</span>
          </>
        )}
        {showStatusBlockNumber && (
          <>
            <span className="editor-status-block">块 {currentStatusBlock} / {totalBlocks}</span>
            <span className="stat-sep">|</span>
          </>
        )}
        <span className="editor-status-secondary">
          <span ref={scrollPositionRef} className="editor-status-position">位置 0%</span>
          <span className="stat-sep">|</span>
          <span>{chars} 字符</span>
          <span className="stat-sep">|</span>
          <span>{words} 词</span>
          <span className="stat-sep">|</span>
          <span className="stat-hint">
            {vimModeEnabled
              ? readonly ? "NORMAL · 只读导航 · Ctrl+F/B 翻页" : "Esc Normal · i Insert · Ctrl+F/B 翻页"
              : "Ctrl+Z · 粘贴/拖入图片"}
          </span>
        </span>
        {onVersionOpen && (
          <span className="editor-status-actions">
            <span className="stat-sep" />
            <span className="btn-debug-toggle-wrapper">
              <button
                className="btn-debug-toggle"
                onClick={toggleDebug}
                title="调试日志"
                type="button"
              >
                🐛
              </button>
            </span>
            <span className="stat-sep" />
            <button className="btn-version-icon" onClick={onVersionOpen} title="版本历史">
              📋
            </button>
          </span>
        )}
      </div>}

      {/* ── 正文右键菜单 ── */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="editor-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => {
            // 菜单依赖 ProseMirror 当前选区。阻止按钮在按下时夺走焦点，
            // 这样关闭菜单后 Vim 可立即继续接收 h/j/k/l 等命令。
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {!readonly && (
            <>
              <button
                className="editor-context-item"
                disabled={!editor.can().undo()}
                onClick={() => { editor.chain().focus().undo().run(); setContextMenu(null); }}
              >撤销</button>
              <button
                className="editor-context-item"
                disabled={!editor.can().redo()}
                onClick={() => { editor.chain().focus().redo().run(); setContextMenu(null); }}
              >重做</button>
              <div className="editor-context-sep" />
              <button
                className="editor-context-item"
                disabled={!hasSelection()}
                onClick={() => { handleCut(); setContextMenu(null); }}
              >剪切</button>
              <button
                className="editor-context-item"
                onClick={() => { handleClipboardPaste(); setContextMenu(null); }}
              >粘贴</button>
            </>
          )}
          <button
            className="editor-context-item"
            disabled={!hasSelection()}
            onClick={() => { handleCopy(); setContextMenu(null); }}
          >复制</button>
          <button
            className="editor-context-item"
            onClick={() => { editor.chain().focus().selectAll().run(); setContextMenu(null); }}
          >全选</button>
          {bookmarks.length > 0 && (
            <button
              className="editor-context-item"
              onClick={() => { setBookmarkOpen(true); setContextMenu(null); }}
            >打开书签列表 <span>{bookmarks.length}</span></button>
          )}
          {!readonly && (
            <>
              <div className="editor-context-sep" />
              <button
                className="editor-context-item"
                onClick={() => { toggleCurrentBookmark(); setContextMenu(null); }}
              >{currentBookmark ? "取消当前位置书签" : "添加当前位置书签"} <span>Ctrl+Shift+M</span></button>
              <button
                className="editor-context-item editor-context-parent"
                aria-expanded={contextSubmenu === "format"}
                onClick={() => setContextSubmenu((current) => current === "format" ? null : "format")}
              ><span>格式</span><span aria-hidden="true">{contextSubmenu === "format" ? "▾" : "▸"}</span></button>
              {contextSubmenu === "format" && (
                <div className="editor-context-submenu" role="group" aria-label="格式">
                  <button
                    className="editor-context-item editor-context-subitem"
                    disabled={!hasSelection()}
                    onClick={() => { editor.chain().focus().toggleBold().run(); setContextMenu(null); }}
                  >粗体 <span>Ctrl+B</span></button>
                  <button
                    className="editor-context-item editor-context-subitem"
                    disabled={!hasSelection()}
                    onClick={() => { editor.chain().focus().toggleItalic().run(); setContextMenu(null); }}
                  >斜体 <span>Ctrl+I</span></button>
                  <button
                    className="editor-context-item editor-context-subitem"
                    disabled={!hasSelection()}
                    onClick={() => { editor.chain().focus().toggleStrike().run(); setContextMenu(null); }}
                  >删除线</button>
                  <button
                    className="editor-context-item editor-context-subitem"
                    disabled={!hasSelection()}
                    onClick={() => { editor.chain().focus().toggleCode().run(); setContextMenu(null); }}
                  >行内代码</button>
                  <button
                    className="editor-context-item editor-context-subitem"
                    disabled={!hasSelection()}
                    onClick={() => { editor.chain().focus().unsetAllMarks().run(); setContextMenu(null); }}
                  >清除文本格式</button>
                  <button
                    className="editor-context-item editor-context-subitem"
                    disabled={!hasSelection()}
                    onClick={convertSelectionFromMarkdown}
                  >转换所选 Markdown</button>
                </div>
              )}
              <button
                className="editor-context-item editor-context-parent"
                aria-expanded={contextSubmenu === "paragraph"}
                onClick={() => setContextSubmenu((current) => current === "paragraph" ? null : "paragraph")}
              ><span>段落</span><span aria-hidden="true">{contextSubmenu === "paragraph" ? "▾" : "▸"}</span></button>
              {contextSubmenu === "paragraph" && (
                <div className="editor-context-submenu" role="group" aria-label="段落">
                  <button
                    className="editor-context-item editor-context-subitem"
                    onClick={() => { editor.chain().focus().clearNodes().run(); setContextMenu(null); }}
                  >正文</button>
                  <button
                    className="editor-context-item editor-context-subitem"
                    onClick={() => { editor.chain().focus().toggleHeading({ level: 3 }).run(); setContextMenu(null); }}
                  >三级标题 H3</button>
                  <button
                    className="editor-context-item editor-context-subitem"
                    onClick={() => { editor.chain().focus().toggleHeading({ level: 4 }).run(); setContextMenu(null); }}
                  >四级标题 H4</button>
                  <button
                    className="editor-context-item editor-context-subitem"
                    onClick={() => { editor.chain().focus().toggleBlockquote().run(); setContextMenu(null); }}
                  >引用块</button>
                  <button
                    className="editor-context-item editor-context-subitem"
                    onClick={() => { editor.chain().focus().toggleBulletList().run(); setContextMenu(null); }}
                  >无序列表</button>
                  <button
                    className="editor-context-item editor-context-subitem"
                    onClick={() => { editor.chain().focus().toggleOrderedList().run(); setContextMenu(null); }}
                  >有序列表</button>
                  <button
                    className="editor-context-item editor-context-subitem"
                    onClick={() => { changeSelectedBlockIndent(1); setContextMenu(null); }}
                  >增加块缩进 <span>Tab</span></button>
                  <button
                    className="editor-context-item editor-context-subitem"
                    onClick={() => { changeSelectedBlockIndent(-1); setContextMenu(null); }}
                  >减少块缩进 <span>Shift+Tab</span></button>
                </div>
              )}
              <button
                className="editor-context-item editor-context-parent"
                aria-expanded={contextSubmenu === "insert"}
                onClick={() => setContextSubmenu((current) => current === "insert" ? null : "insert")}
              ><span>插入</span><span aria-hidden="true">{contextSubmenu === "insert" ? "▾" : "▸"}</span></button>
              {contextSubmenu === "insert" && (
                <div className="editor-context-submenu" role="group" aria-label="插入">
                  <button
                    className="editor-context-item editor-context-subitem"
                    disabled={!hasSelection()}
                    onClick={() => {
                      setLinkDialogUrl(editor.getAttributes("link").href || "");
                      setContextMenu(null);
                      setLinkDialog(true);
                    }}
                  >链接</button>
                  <button
                    className="editor-context-item editor-context-subitem"
                    onClick={() => { setContextMenu(null); setImageDialog(true); }}
                  >图片</button>
                  <button
                    className="editor-context-item editor-context-subitem"
                    onClick={() => { editor.chain().focus().setHorizontalRule().run(); setContextMenu(null); }}
                  >水平分隔线</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── 插入链接对话框（复用图片对话框样式）── */}
      {linkDialog && (
        <div className="image-dialog-overlay" onClick={() => setLinkDialog(false)}>
          <div className="image-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="image-dialog-header">
              插入链接
              <button className="image-dialog-close" onClick={() => setLinkDialog(false)}>✕</button>
            </div>
            <input
              className="image-dialog-input"
              placeholder="https://..."
              value={linkDialogUrl}
              onChange={(e) => setLinkDialogUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && insertLink()}
              autoFocus
            />
            <p className="image-dialog-hint">选中文字将变为链接；未选中时插入 URL 本身</p>
            <div className="image-dialog-actions">
              <button className="menu-btn" onClick={() => setLinkDialog(false)}>取消</button>
              <button className="menu-btn active" onClick={insertLink}>插入</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 图片 URL 对话框 ── */}
      {imageDialog && (
        <div className="image-dialog-overlay" onClick={() => setImageDialog(false)}>
          <div className="image-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="image-dialog-header">
              插入图片
              <button className="image-dialog-close" onClick={() => setImageDialog(false)}>✕</button>
            </div>
            <input
              className="image-dialog-input"
              placeholder="图片 URL 或 base64"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && insertImageUrl()}
              autoFocus
            />
            <p className="image-dialog-hint">支持：https:// 或 data:image/... base64</p>
            <div className="image-dialog-actions">
              <button className="menu-btn" onClick={() => setImageDialog(false)}>取消</button>
              <button className="menu-btn active" onClick={insertImageUrl}>插入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
