import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  PasswordResponses,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  addLocalPdfBookmark,
  addLocalPdfHighlight,
  deleteLocalPdfBookmark,
  deleteLocalPdfHighlight,
  getLocalPdf,
  listLocalPdfBookmarks,
  listLocalPdfHighlights,
  updateLocalPdfProgress,
  type LocalPdfBookmark,
  type LocalPdfEntry,
  type LocalPdfHighlight,
} from "../lib/pdf-library";
import { toggleTauriFullscreen } from "../lib/fullscreen";
import { isTauriRuntime } from "../lib/runtime";
import { useTransientMessage } from "../hooks/useTransientMessage";
import type { PdfHighlightGeometry } from "../lib/pdf-annotation-export";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface Props {
  documentId: string;
  onClose: () => void;
  onFullscreenChange?: (fullscreen: boolean) => void;
  initialHighlightId?: string | null;
  initialTargetRange?: { page: number; start: number; end: number } | null;
  onCreateExcerpt?: (excerpt: { pdfId: string; pdfName: string; page: number; selectedText: string; highlightId: string; start: number; end: number }) => Promise<void>;
}

interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineItem[];
}

interface PageTextCache {
  text: string;
  items: string[];
  starts: number[];
}

interface SearchMatch {
  page: number;
  offset: number;
}

interface PdfTextSelection {
  page: number;
  text: string;
  start: number;
  end: number;
}

interface TouchGesture {
  x: number;
  y: number;
  startedAt: number;
  atLeft: boolean;
  atRight: boolean;
}

interface PinchGesture {
  initialDistance: number;
  initialZoom: number;
  targetZoom: number;
  anchorX: number;
  anchorY: number;
}

function touchDistance(first: React.Touch, second: React.Touch): number {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

function pageTextCache(items: string[]): PageTextCache {
  const starts: number[] = [];
  let text = "";
  for (const item of items) {
    if (text) text += " ";
    starts.push(text.length);
    text += item;
  }
  return { text: text.toLocaleLowerCase(), items, starts };
}

function clampZoom(value: number): number {
  return Math.max(0.25, Math.min(4, value));
}

function clampPage(page: number, total: number): number {
  return Math.max(1, Math.min(total || 1, Math.round(page) || 1));
}

function pdfErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name === "PasswordException") return "密码不正确或未提供密码";
  if (error.name === "InvalidPDFException") return "PDF 文件已损坏或格式不受支持";
  return error.message || "PDF 打开失败";
}

interface WebkitFullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface WebkitFullscreenElement extends HTMLDivElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

type PdfViewMode = "horizontal" | "vertical";

export function PdfReader({ documentId, onClose, onFullscreenChange, initialHighlightId, initialTargetRange, onCreateExcerpt }: Props) {
  const readerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const pageSurfaceRefs = useRef(new Map<number, HTMLDivElement>());
  const textLayerElementRefs = useRef(new Map<number, HTMLDivElement>());
  const canvasRefCallbacks = useRef(new Map<number, (node: HTMLCanvasElement | null) => void>());
  const pageSurfaceRefCallbacks = useRef(new Map<number, (node: HTMLDivElement | null) => void>());
  const textLayerRefCallbacks = useRef(new Map<number, (node: HTMLDivElement | null) => void>());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const textLayerRefs = useRef(new Map<number, TextLayer>());
  const renderTaskRefs = useRef(new Map<number, RenderTask>());
  const pageRenderPipelineRefs = useRef(new Map<number, Promise<void>>());
  const pageRequestedSignatureRefs = useRef(new Map<number, string>());
  const pageRenderVersionRefs = useRef(new Map<number, number>());
  const documentRenderGenerationRef = useRef(0);
  const textCacheRef = useRef(new Map<number, PageTextCache>());
  const touchGestureRef = useRef<TouchGesture | null>(null);
  const pinchGestureRef = useRef<PinchGesture | null>(null);
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const searchRequestRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const latestProgressRef = useRef<{
    id: string;
    page: number;
    zoom: number;
    fitWidth: boolean;
    fitHeight: boolean;
    viewMode: PdfViewMode;
    pageCount: number;
  } | null>(null);
  const [entry, setEntry] = useState<LocalPdfEntry | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [fitHeight, setFitHeight] = useState(false);
  const [viewMode, setViewMode] = useState<PdfViewMode>("horizontal");
  const [visibleVerticalPages, setVisibleVerticalPages] = useState<Set<number>>(() => new Set([1]));
  const [showHighlights, setShowHighlights] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineMode, setOutlineMode] = useState<"outline" | "pages" | "highlights" | "bookmarks">("outline");
  const [pageLabels, setPageLabels] = useState<string[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchStatus, setSearchStatus] = useState("");
  const { message: actionNotice, showMessage: showActionNotice, clearMessage: clearActionNotice } = useTransientMessage();
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [completedSearchQuery, setCompletedSearchQuery] = useState("");
  const [textLayerRevision, setTextLayerRevision] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [immersiveFallback, setImmersiveFallback] = useState(false);
  const [fullscreenControlsVisible, setFullscreenControlsVisible] = useState(true);
  const [selectionAnchor, setSelectionAnchor] = useState<PdfTextSelection | null>(null);
  const [highlights, setHighlights] = useState<LocalPdfHighlight[]>([]);
  const [bookmarks, setBookmarks] = useState<LocalPdfBookmark[]>([]);
  const [targetHighlightId, setTargetHighlightId] = useState(initialHighlightId ?? (initialTargetRange ? "pdf-source-target" : null));
  const [highlightSaving, setHighlightSaving] = useState(false);
  const [excerptSaving, setExcerptSaving] = useState(false);
  const [annotatedPdfExporting, setAnnotatedPdfExporting] = useState(false);

  const applyFullscreenState = useCallback((next: boolean) => {
    if (!next) setImmersiveFallback(false);
    setFullscreenControlsVisible(true);
    setFullscreen(next);
    onFullscreenChange?.(next);
  }, [onFullscreenChange]);

  useEffect(() => {
    if (!fullscreen || !fullscreenControlsVisible) return;
    const timer = window.setTimeout(() => setFullscreenControlsVisible(false), 1000);
    return () => window.clearTimeout(timer);
  }, [fullscreen, fullscreenControlsVisible]);

  useEffect(() => {
    const updateSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setSelectionAnchor(null);
        return;
      }
      const anchor = selection.anchorNode;
      const focus = selection.focusNode;
      if (!anchor || !focus) {
        setSelectionAnchor(null);
        return;
      }
      let layer: HTMLElement | null = null;
      let current: HTMLElement | null = anchor instanceof HTMLElement ? anchor : anchor.parentElement;
      while (current) {
        if (current.classList.contains("pdf-text-layer")) {
          layer = current;
          break;
        }
        current = current.parentElement;
      }
      if (!layer || !layer.contains(anchor) || !layer.contains(focus)) {
        setSelectionAnchor(null);
        return;
      }
      const pageNumber = Number(layer.dataset.pdfPage);
      if (!Number.isFinite(pageNumber) || Number.isNaN(pageNumber)) {
        setSelectionAnchor(null);
        return;
      }
      const cached = textCacheRef.current.get(pageNumber);
      const pageTextLayer = textLayerRefs.current.get(pageNumber);
      const divs = pageTextLayer?.textDivs;
      if (!cached || !divs) {
        setSelectionAnchor(null);
        return;
      }
      const pageOffset = (node: Node, offset: number) => {
        let element = node instanceof Element ? node : node.parentElement;
        while (element && element.parentElement !== layer) element = element.parentElement;
        const itemIndex = element ? divs.indexOf(element as HTMLDivElement) : -1;
        if (itemIndex < 0) return null;
        const range = document.createRange();
        range.setStart(element!, 0);
        range.setEnd(node, offset);
        return cached.starts[itemIndex] + range.toString().length;
      };
      try {
        const anchorOffset = pageOffset(anchor, selection.anchorOffset);
        const focusOffset = pageOffset(focus, selection.focusOffset);
        const text = selection.toString().trim().slice(0, 20_000);
        if (anchorOffset === null || focusOffset === null || !text) {
          setSelectionAnchor(null);
          return;
        }
        setSelectionAnchor({
          page: pageNumber,
          text,
          start: Math.min(anchorOffset, focusOffset),
          end: Math.max(anchorOffset, focusOffset),
        });
      } catch {
        setSelectionAnchor(null);
      }
    };
    document.addEventListener("selectionchange", updateSelection);
    return () => document.removeEventListener("selectionchange", updateSelection);
  }, [textLayerRevision]);

  const ensureSelectionHighlight = useCallback(async () => {
    if (!entry || !selectionAnchor) throw new Error("请先选择 PDF 文本");
    const existing = highlights.find((highlight) => (
      highlight.page === selectionAnchor.page
      && highlight.start === selectionAnchor.start
      && highlight.end === selectionAnchor.end
    ));
    if (existing) return { highlight: existing, created: false };
    const highlight = await addLocalPdfHighlight({
      pdfId: entry.id,
      page: selectionAnchor.page,
      start: selectionAnchor.start,
      end: selectionAnchor.end,
      text: selectionAnchor.text,
    });
    setHighlights((current) => [...current, highlight]);
    return { highlight, created: true };
  }, [entry, highlights, selectionAnchor]);

  const saveHighlight = useCallback(async () => {
    if (!selectionAnchor || highlightSaving) return;
    setHighlightSaving(true);
    try {
      await ensureSelectionHighlight();
      window.getSelection()?.removeAllRanges();
      setSelectionAnchor(null);
      showActionNotice("已保存高亮");
    } catch (reason) {
      showActionNotice(`高亮失败：${pdfErrorMessage(reason)}`);
    } finally {
      setHighlightSaving(false);
    }
  }, [ensureSelectionHighlight, highlightSaving, selectionAnchor, showActionNotice]);

  const createExcerpt = useCallback(async () => {
    if (!onCreateExcerpt || !entry || !selectionAnchor || excerptSaving) return;
    setExcerptSaving(true);
    let createdHighlight: LocalPdfHighlight | null = null;
    try {
      const { highlight, created } = await ensureSelectionHighlight();
      if (created) createdHighlight = highlight;
      await onCreateExcerpt({
        pdfId: entry.id,
        pdfName: entry.name,
        page: selectionAnchor.page,
        selectedText: selectionAnchor.text,
        highlightId: highlight.id,
        start: selectionAnchor.start,
        end: selectionAnchor.end,
      });
      window.getSelection()?.removeAllRanges();
      setSelectionAnchor(null);
    } catch (reason) {
      if (createdHighlight) {
        await deleteLocalPdfHighlight(createdHighlight.id).catch(() => {});
        setHighlights((current) => current.filter((highlight) => highlight.id !== createdHighlight?.id));
      }
      showActionNotice(`摘录失败：${pdfErrorMessage(reason)}`);
    } finally {
      setExcerptSaving(false);
    }
  }, [ensureSelectionHighlight, entry, excerptSaving, onCreateExcerpt, selectionAnchor, showActionNotice]);

  const enterImmersiveFallback = useCallback(() => {
    setImmersiveFallback(true);
    applyFullscreenState(true);
  }, [applyFullscreenState]);

  const exitFullscreen = useCallback(async () => {
    if (isTauriRuntime()) {
      if (fullscreen) await toggleTauriFullscreen();
      applyFullscreenState(false);
      return;
    }
    const fullscreenDocument = document as WebkitFullscreenDocument;
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (fullscreenDocument.webkitFullscreenElement) await fullscreenDocument.webkitExitFullscreen?.();
    applyFullscreenState(false);
  }, [applyFullscreenState, fullscreen]);

  const toggleFullscreen = useCallback(async () => {
    try {
      // iOS 沉浸式回退没有 document.fullscreenElement，必须优先使用
      // 阅读器自身状态判断退出，否则按钮会再次执行“进入全屏”。
      if (fullscreen) {
        await exitFullscreen();
        return;
      }
      if (isTauriRuntime()) {
        const next = await toggleTauriFullscreen();
        if (next !== null) applyFullscreenState(next);
        return;
      }
      const fullscreenDocument = document as WebkitFullscreenDocument;
      const element = readerRef.current as WebkitFullscreenElement | null;
      if (document.fullscreenElement || fullscreenDocument.webkitFullscreenElement) {
        await exitFullscreen();
      } else if (element?.requestFullscreen) {
        await element.requestFullscreen();
        if (!document.fullscreenElement && !fullscreenDocument.webkitFullscreenElement) {
          enterImmersiveFallback();
        }
      } else if (element?.webkitRequestFullscreen) {
        await element.webkitRequestFullscreen();
        if (!document.fullscreenElement && !fullscreenDocument.webkitFullscreenElement) {
          enterImmersiveFallback();
        }
      } else {
        // iOS 主屏幕 Web App 不提供元素 Fullscreen API。此时应用本身已经
        // 占据系统允许的全部视口，改用隐藏非必要控件的沉浸式阅读回退。
        enterImmersiveFallback();
      }
    } catch (reason) {
      if (!isTauriRuntime()) enterImmersiveFallback();
      else showActionNotice(`全屏切换失败：${pdfErrorMessage(reason)}`);
    }
  }, [applyFullscreenState, enterImmersiveFallback, exitFullscreen, fullscreen, showActionNotice]);

  const closeReader = useCallback(async () => {
    try {
      if (fullscreen) await exitFullscreen();
    } catch (reason) {
      console.warn("[PDF] 退出阅读全屏失败:", reason);
    } finally {
      onClose();
    }
  }, [exitFullscreen, fullscreen, onClose]);

  useEffect(() => {
    if (isTauriRuntime()) {
      let disposed = false;
      let unlisten: (() => void) | undefined;
      void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        const sync = async () => {
          const next = await appWindow.isFullscreen();
          if (!disposed) applyFullscreenState(next);
        };
        await sync();
        unlisten = await appWindow.onResized(() => { void sync().catch(() => {}); });
        if (disposed) unlisten();
      }).catch(() => {});
      return () => {
        disposed = true;
        unlisten?.();
        onFullscreenChange?.(false);
      };
    }

    const sync = () => {
      const fullscreenDocument = document as WebkitFullscreenDocument;
      applyFullscreenState(Boolean(document.fullscreenElement || fullscreenDocument.webkitFullscreenElement));
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
      onFullscreenChange?.(false);
    };
  }, [applyFullscreenState, onFullscreenChange]);

  useEffect(() => {
    let cancelled = false;
    let loadedDocument: PDFDocumentProxy | null = null;
    const documentGeneration = documentRenderGenerationRef.current + 1;
    documentRenderGenerationRef.current = documentGeneration;
    const open = async () => {
      setLoading(true);
      setError(null);
      setPdf(null);
      viewportRef.current?.style.removeProperty("--pdf-page-aspect-ratio");
      canvasRefs.current.clear();
      pageSurfaceRefs.current.clear();
      textLayerElementRefs.current.clear();
      textCacheRef.current.clear();
      renderTaskRefs.current.forEach((task) => task.cancel());
      textLayerRefs.current.forEach((textLayer) => textLayer.cancel());
      setSearchMatches([]);
      setActiveSearchIndex(-1);
      setHighlights([]);
      setBookmarks([]);
      setTargetHighlightId(initialHighlightId ?? (initialTargetRange ? "pdf-source-target" : null));
      const stored = await getLocalPdf(documentId);
      if (!stored) throw new Error("PDF 不存在或已经被删除");
      if (cancelled || documentRenderGenerationRef.current !== documentGeneration) return;
      setEntry(stored.entry);
      setPage(Math.max(1, stored.entry.page));
      setPageInput(String(Math.max(1, stored.entry.page)));
      setZoom(stored.entry.zoom || 1);
      setFitWidth(stored.entry.fitWidth !== false);
      setFitHeight(Boolean(stored.entry.fitHeight));
      setViewMode(stored.entry.viewMode === "vertical" ? "vertical" : "horizontal");

      const [data, storedHighlights, storedBookmarks] = await Promise.all([
        stored.blob.arrayBuffer(),
        listLocalPdfHighlights(documentId),
        listLocalPdfBookmarks(documentId),
      ]);
      if (cancelled || documentRenderGenerationRef.current !== documentGeneration) return;
      setHighlights(storedHighlights);
      setBookmarks(storedBookmarks);
      const loadingTask = getDocument({ data });
      loadingTask.onPassword = (updatePassword: (password: string) => void, reason: number) => {
        const promptText = reason === PasswordResponses.INCORRECT_PASSWORD
          ? "密码不正确，请重新输入 PDF 密码"
          : "此 PDF 受密码保护，请输入密码";
        const password = window.prompt(promptText);
        if (password === null) {
          void loadingTask.destroy();
          return;
        }
        updatePassword(password);
      };
      loadedDocument = await loadingTask.promise;
      if (cancelled || documentRenderGenerationRef.current !== documentGeneration) {
        await loadedDocument.destroy();
        return;
      }
      setPdf(loadedDocument);
      const restoredPage = clampPage(stored.entry.page, loadedDocument.numPages);
      setPage(restoredPage);
      setVisibleVerticalPages(new Set([restoredPage]));
      setPageInput(String(restoredPage));
      const [documentOutline, labels] = await Promise.all([
        loadedDocument.getOutline(),
        loadedDocument.getPageLabels(),
      ]);
      if (!cancelled) {
        const nextOutline = (documentOutline ?? []) as OutlineItem[];
        setOutline(nextOutline);
        setOutlineMode(nextOutline.length > 0 ? "outline" : "pages");
        setPageLabels(labels);
      }
    };
    void open()
      .catch((reason) => { if (!cancelled) setError(pdfErrorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (documentRenderGenerationRef.current === documentGeneration) {
        documentRenderGenerationRef.current += 1;
      }
      renderTaskRefs.current.forEach((task) => task.cancel());
      textLayerRefs.current.forEach((textLayer) => textLayer.cancel());
      void loadedDocument?.destroy();
    };
  }, [documentId, initialHighlightId, initialTargetRange]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => {
      setViewportWidth(element.clientWidth);
      setViewportHeight(element.clientHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const renderedPages = useMemo(() => {
    if (!pdf) return [];
    if (viewMode === "horizontal") return [clampPage(page, pdf.numPages)];
    const pages = new Set(visibleVerticalPages);
    const currentPage = clampPage(page, pdf.numPages);
    pages.add(currentPage);
    if (currentPage > 1) pages.add(currentPage - 1);
    if (currentPage < pdf.numPages) pages.add(currentPage + 1);
    return [...pages].filter((pageNumber) => pageNumber >= 1 && pageNumber <= pdf.numPages).sort((a, b) => a - b);
  }, [page, pdf, viewMode, visibleVerticalPages]);

  const allPdfPages = useMemo(
    () => pdf ? Array.from({ length: pdf.numPages }, (_, index) => index + 1) : [],
    [pdf],
  );
  const displayedPages = viewMode === "vertical" ? allPdfPages : renderedPages;

  const canvasRefForPage = useCallback((pageNumber: number) => {
    let callback = canvasRefCallbacks.current.get(pageNumber);
    if (callback) return callback;
    callback = (node) => {
      if (node) {
        canvasRefs.current.set(pageNumber, node);
        return;
      }
      canvasRefs.current.delete(pageNumber);
      renderTaskRefs.current.get(pageNumber)?.cancel();
      pageRenderVersionRefs.current.set(pageNumber, (pageRenderVersionRefs.current.get(pageNumber) ?? 0) + 1);
      pageRequestedSignatureRefs.current.delete(pageNumber);
    };
    canvasRefCallbacks.current.set(pageNumber, callback);
    return callback;
  }, []);

  const pageSurfaceRefForPage = useCallback((pageNumber: number) => {
    let callback = pageSurfaceRefCallbacks.current.get(pageNumber);
    if (callback) return callback;
    callback = (node) => {
      if (node) pageSurfaceRefs.current.set(pageNumber, node);
      else pageSurfaceRefs.current.delete(pageNumber);
    };
    pageSurfaceRefCallbacks.current.set(pageNumber, callback);
    return callback;
  }, []);

  const textLayerRefForPage = useCallback((pageNumber: number) => {
    let callback = textLayerRefCallbacks.current.get(pageNumber);
    if (callback) return callback;
    callback = (node) => {
      if (node) {
        textLayerElementRefs.current.set(pageNumber, node);
        return;
      }
      textLayerElementRefs.current.delete(pageNumber);
      textLayerRefs.current.get(pageNumber)?.cancel();
      textLayerRefs.current.delete(pageNumber);
    };
    textLayerRefCallbacks.current.set(pageNumber, callback);
    return callback;
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!pdf || viewMode !== "vertical" || !viewport) {
      setVisibleVerticalPages(new Set([page]));
      return;
    }
    const mobileViewport = window.matchMedia("(max-width: 768px)").matches;
    const observer = new IntersectionObserver((entries) => {
      startTransition(() => {
        setVisibleVerticalPages((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const pageNumber = Number((entry.target as HTMLElement).dataset.pdfPage);
            if (!Number.isFinite(pageNumber)) continue;
            if (entry.isIntersecting) next.add(pageNumber);
            else next.delete(pageNumber);
          }
          if (next.size === current.size && [...next].every((pageNumber) => current.has(pageNumber))) return current;
          return next;
        });
      });
    }, {
      root: viewport,
      rootMargin: `${Math.max(mobileViewport ? 180 : 480, Math.ceil(viewportHeight * (mobileViewport ? 0.65 : 1.75)))}px 0px`,
      threshold: 0,
    });
    pageSurfaceRefs.current.forEach((surface) => observer.observe(surface));
    return () => observer.disconnect();
  }, [displayedPages, page, pdf, viewMode, viewportHeight]);

  useEffect(() => {
    if (!pdf || !renderedPages.length || viewportWidth <= 0 || viewportHeight <= 0) return;
    let cancelled = false;
    const documentGeneration = documentRenderGenerationRef.current;
    const currentPages = [...renderedPages];
    const renderSignature = [documentGeneration, viewportWidth, viewportHeight, fitWidth, fitHeight, zoom].join(":");
    const pagesToRender = currentPages.filter(
      (pageNumber) => canvasRefs.current.get(pageNumber)?.dataset.pdfRenderSignature !== renderSignature
        && pageRequestedSignatureRefs.current.get(pageNumber) !== renderSignature,
    );
    if (pagesToRender.length === 0) return;
    pagesToRender.forEach((pageNumber) => {
      const previousSignature = pageRequestedSignatureRefs.current.get(pageNumber);
      if (previousSignature && previousSignature !== renderSignature) {
        renderTaskRefs.current.get(pageNumber)?.cancel();
      }
      pageRequestedSignatureRefs.current.set(pageNumber, renderSignature);
    });
    setRendering(true);

    const render = async () => {
      const surfacePadding = 24;
      const availableWidth = Math.max(160, viewportWidth - surfacePadding);
      const availableHeight = Math.max(120, viewportHeight - surfacePadding);
      const viewportRect = viewportRef.current?.getBoundingClientRect();
      const renderDistance = (pageNumber: number) => {
        const rect = pageSurfaceRefs.current.get(pageNumber)?.getBoundingClientRect();
        if (!rect || !viewportRect) return Number.MAX_SAFE_INTEGER;
        if (rect.bottom < viewportRect.top) return viewportRect.top - rect.bottom;
        if (rect.top > viewportRect.bottom) return rect.top - viewportRect.bottom;
        return 0;
      };
      const orderedPages = [...pagesToRender].sort((left, right) => renderDistance(left) - renderDistance(right));
      const renderPage = (pageNumber: number) => {
        const renderVersion = (pageRenderVersionRefs.current.get(pageNumber) ?? 0) + 1;
        pageRenderVersionRefs.current.set(pageNumber, renderVersion);
        const previousPipeline = pageRenderPipelineRefs.current.get(pageNumber) ?? Promise.resolve();
        const pipeline = previousPipeline.catch(() => {}).then(async () => {
          const canvas = canvasRefs.current.get(pageNumber);
          const surface = pageSurfaceRefs.current.get(pageNumber);
          const textLayerElement = textLayerElementRefs.current.get(pageNumber);
          if (!canvas || !surface || !textLayerElement) return;

          const isStale = () => documentRenderGenerationRef.current !== documentGeneration
            || pageRenderVersionRefs.current.get(pageNumber) !== renderVersion
            || canvasRefs.current.get(pageNumber) !== canvas
            || textLayerElementRefs.current.get(pageNumber) !== textLayerElement;
          if (isStale()) return;

          const previousTask = renderTaskRefs.current.get(pageNumber);
          if (previousTask) {
            previousTask.cancel();
            try {
              await previousTask.promise;
            } catch {
              // Ignore cancellation or previous completion errors
            }
            renderTaskRefs.current.delete(pageNumber);
          }

          if (isStale()) return;

          const previousTextLayer = textLayerRefs.current.get(pageNumber);
          if (previousTextLayer) {
            previousTextLayer.cancel();
            textLayerRefs.current.delete(pageNumber);
          }

          const pdfPage = await pdf.getPage(pageNumber);
          if (isStale()) return;

          const baseViewport = pdfPage.getViewport({ scale: 1 });
          if (viewMode === "vertical" && baseViewport.height > 0) {
            const viewportElement = viewportRef.current;
            if (viewportElement && !viewportElement.style.getPropertyValue("--pdf-page-aspect-ratio")) {
              viewportElement.style.setProperty("--pdf-page-aspect-ratio", String(baseViewport.width / baseViewport.height));
            }
          }
          const displayScale = fitHeight
            ? clampZoom(availableHeight / baseViewport.height)
            : fitWidth
              ? clampZoom(availableWidth / baseViewport.width)
              : clampZoom(zoom);
          const displayViewport = pdfPage.getViewport({ scale: displayScale });
          const mobileViewport = window.matchMedia("(max-width: 768px)").matches;
          const outputPixelBudget = mobileViewport ? 4_000_000 : 20_000_000;
          const pixelBudgetScale = Math.sqrt(outputPixelBudget / Math.max(1, displayViewport.width * displayViewport.height));
          const outputScale = Math.min(window.devicePixelRatio || 1, mobileViewport ? 1.6 : 2.5, pixelBudgetScale);

          const stagedCanvas = document.createElement("canvas");
          const context = stagedCanvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("当前环境不支持 Canvas PDF 渲染");

          stagedCanvas.width = Math.max(1, Math.floor(displayViewport.width * outputScale));
          stagedCanvas.height = Math.max(1, Math.floor(displayViewport.height * outputScale));
          surface.style.width = `${Math.floor(displayViewport.width)}px`;
          surface.style.height = `${Math.floor(displayViewport.height)}px`;
          surface.style.setProperty("--scale-factor", String(displayScale));
          surface.dataset.pdfPage = String(pageNumber);
          textLayerElement.replaceChildren();
          textLayerElement.style.width = `${Math.floor(displayViewport.width)}px`;
          textLayerElement.style.height = `${Math.floor(displayViewport.height)}px`;
          textLayerElement.dataset.pdfPage = String(pageNumber);

          const textContent = await pdfPage.getTextContent();
          if (isStale()) return;
          textCacheRef.current.set(
            pageNumber,
            pageTextCache(textContent.items.map((item) => ("str" in item ? item.str : ""))),
          );
          const textLayer = new TextLayer({
            textContentSource: textContent,
            container: textLayerElement,
            viewport: displayViewport,
          });
          if (isStale()) return;
          textLayerRefs.current.set(pageNumber, textLayer);
          const renderTask = pdfPage.render({
            canvasContext: context,
            viewport: displayViewport,
            transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
            background: "rgb(255,255,255)",
          });
          renderTaskRefs.current.set(pageNumber, renderTask);

          let completed = false;
          try {
            await Promise.all([renderTask.promise, textLayer.render()]);
            if (isStale()) return;
            canvas.width = stagedCanvas.width;
            canvas.height = stagedCanvas.height;
            canvas.style.width = `${Math.floor(displayViewport.width)}px`;
            canvas.style.height = `${Math.floor(displayViewport.height)}px`;
            const visibleContext = canvas.getContext("2d", { alpha: false });
            if (!visibleContext) throw new Error("当前环境不支持 Canvas PDF 渲染");
            visibleContext.drawImage(stagedCanvas, 0, 0);
            canvas.dataset.pdfRenderSignature = renderSignature;
            completed = true;
          } finally {
            if (renderTaskRefs.current.get(pageNumber) === renderTask) renderTaskRefs.current.delete(pageNumber);
            if (!completed && textLayerRefs.current.get(pageNumber) === textLayer) {
              textLayerRefs.current.delete(pageNumber);
            }
          }

          const anchor = pageNumber === page ? zoomAnchorRef.current : null;
          if (!isStale() && anchor) {
            zoomAnchorRef.current = null;
            window.requestAnimationFrame(() => {
              const scrollViewport = viewportRef.current;
              const nextSurface = pageSurfaceRefs.current.get(pageNumber);
              if (!scrollViewport || !nextSurface) return;
              scrollViewport.scrollLeft = anchor.x * nextSurface.clientWidth - scrollViewport.clientWidth / 2;
              scrollViewport.scrollTop = anchor.y * nextSurface.clientHeight - scrollViewport.clientHeight / 2;
            });
          }
          if (!isStale() && (fitWidth || fitHeight) && pageNumber === page) setZoom(displayScale);
        });
        pageRenderPipelineRefs.current.set(pageNumber, pipeline);
        void pipeline.finally(() => {
          if (pageRenderPipelineRefs.current.get(pageNumber) === pipeline) pageRenderPipelineRefs.current.delete(pageNumber);
          if (pageRequestedSignatureRefs.current.get(pageNumber) === renderSignature) {
            pageRequestedSignatureRefs.current.delete(pageNumber);
          }
        }).catch(() => {});
        return pipeline;
      };

      for (const pageNumber of orderedPages) {
        try {
          await renderPage(pageNumber);
        } catch (reason) {
          if ((reason as { name?: string })?.name !== "RenderingCancelledException") throw reason;
        }
      }
      if (!cancelled) setTextLayerRevision((revision) => revision + 1);
    };

    void render()
      .catch((reason) => {
        if (!cancelled && (reason as { name?: string })?.name !== "RenderingCancelledException") {
          setError(pdfErrorMessage(reason));
        }
      })
      .finally(() => {
        pagesToRender.forEach((pageNumber) => {
          if (pageRequestedSignatureRefs.current.get(pageNumber) === renderSignature) {
            pageRequestedSignatureRefs.current.delete(pageNumber);
          }
        });
        setRendering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fitHeight, fitWidth, page, pdf, renderedPages, viewMode, viewportHeight, viewportWidth, zoom]);

  useEffect(() => {
    if (!pdf || !entry) return;
    latestProgressRef.current = {
      id: entry.id,
      page,
      zoom,
      fitWidth,
      fitHeight,
      viewMode,
      pageCount: pdf.numPages,
    };
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void updateLocalPdfProgress(entry.id, {
        page,
        zoom,
        fitWidth,
        fitHeight,
        viewMode,
        pageCount: pdf.numPages,
      })
        .catch((reason) => console.warn("[PDF] 保存阅读进度失败:", reason));
      saveTimerRef.current = null;
    }, 400);
  }, [entry, fitHeight, fitWidth, page, pdf, viewMode, zoom]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    const progress = latestProgressRef.current;
    if (progress) {
      void updateLocalPdfProgress(progress.id, progress)
        .catch((reason) => console.warn("[PDF] 保存最终阅读进度失败:", reason));
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!pdf) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setPage((current) => Math.max(1, current - 1));
      } else if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        setPage((current) => Math.min(pdf.numPages, current + 1));
      } else if (event.key === "Escape") {
        if (fullscreen) void exitFullscreen();
        else void closeReader();
      } else if (event.key === "Home") {
        event.preventDefault();
        setPage(1);
      } else if (event.key === "End") {
        event.preventDefault();
        setPage(pdf.numPages);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setFitWidth(false);
        setFitHeight(false);
        setZoom((value) => Math.min(4, value + 0.15));
      } else if (event.key === "-") {
        event.preventDefault();
        setFitWidth(false);
        setFitHeight(false);
        setZoom((value) => Math.max(0.25, value - 0.15));
      } else if (event.key === "0") {
        event.preventDefault();
        setFitWidth(true);
        setFitHeight(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeReader, exitFullscreen, fullscreen, pdf]);

  useEffect(() => {
    if (!pdf || rendering || page >= pdf.numPages) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      void pdf.getPage(page + 1)
        .then((nextPage) => nextPage.getOperatorList())
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [page, pdf, rendering]);

  useEffect(() => setPageInput(String(page)), [page]);

  const changePage = useCallback((nextPage: number) => {
    if (!pdf) return;
    setPage(clampPage(nextPage, pdf.numPages));
  }, [pdf]);

  const currentPageBookmark = bookmarks.find((bookmark) => bookmark.page === page);

  const togglePageBookmark = useCallback(async () => {
    if (!entry) return;
    try {
      const existing = bookmarks.find((bookmark) => bookmark.page === page);
      if (existing) {
        await deleteLocalPdfBookmark(existing.id);
        setBookmarks((current) => current.filter((bookmark) => bookmark.id !== existing.id));
        showActionNotice(`已取消第 ${page} 页书签`);
      } else {
        const label = pageLabels?.[page - 1];
        const bookmark = await addLocalPdfBookmark(entry.id, page, label ? `${label} · 第 ${page} 页` : `第 ${page} 页`);
        setBookmarks((current) => [...current, bookmark].sort((left, right) => left.page - right.page));
        showActionNotice(`已添加第 ${page} 页书签`);
      }
    } catch (reason) {
      showActionNotice(`书签操作失败：${pdfErrorMessage(reason)}`);
    }
  }, [bookmarks, entry, page, pageLabels, showActionNotice]);

  const jumpToHighlight = useCallback((highlight: LocalPdfHighlight) => {
    setTargetHighlightId(highlight.id);
    changePage(highlight.page);
    if (window.matchMedia("(max-width: 768px)").matches) setOutlineOpen(false);
  }, [changePage]);

  const removeHighlight = useCallback(async (id: string) => {
    try {
      await deleteLocalPdfHighlight(id);
      setHighlights((current) => current.filter((highlight) => highlight.id !== id));
      setTargetHighlightId((current) => current === id ? null : current);
    } catch (reason) {
      showActionNotice(`删除高亮失败：${pdfErrorMessage(reason)}`);
    }
  }, [showActionNotice]);

  const exportAnnotatedPdf = useCallback(async () => {
    if (!pdf || !entry || highlights.length === 0 || annotatedPdfExporting) return;
    setAnnotatedPdfExporting(true);
    clearActionNotice();
    try {
      const stored = await getLocalPdf(entry.id);
      if (!stored) throw new Error("PDF 不存在或已经被删除");
      const { exportPdfWithHighlights, highlightQuadPoints } = await import("../lib/pdf-annotation-export");
      const grouped = new Map<number, LocalPdfHighlight[]>();
      highlights.forEach((highlight) => {
        const pageHighlights = grouped.get(highlight.page) ?? [];
        pageHighlights.push(highlight);
        grouped.set(highlight.page, pageHighlights);
      });
      const geometries: PdfHighlightGeometry[] = [];
      for (const [pageNumber, pageHighlights] of grouped) {
        const pdfPage = await pdf.getPage(pageNumber);
        const textContent = await pdfPage.getTextContent();
        const items = textContent.items.map((item) => ("str" in item ? {
          str: item.str,
          width: item.width,
          height: item.height,
          transform: item.transform,
        } : { str: "", width: 0, height: 0, transform: [] }));
        const cache = pageTextCache(items.map((item) => item.str));
        pageHighlights.forEach((highlight) => {
          geometries.push({
            highlight,
            quadPoints: highlightQuadPoints(items, cache.starts, highlight),
          });
        });
      }
      const exportableCount = geometries.filter((geometry) => geometry.quadPoints.length > 0).length;
      if (exportableCount === 0) throw new Error("无法从当前 PDF 文字层定位高亮区域");
      const bytes = await exportPdfWithHighlights(await stored.blob.arrayBuffer(), geometries);
      const baseName = entry.name.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, "-").slice(0, 120) || "文档";
      const filename = `${baseName}-已标注.pdf`;
      if (isTauriRuntime()) {
        const { exportPdfWithDialog } = await import("../lib/tauri-desktop");
        const path = await exportPdfWithDialog(bytes, filename);
        if (!path) return;
      } else {
        const blobBytes = new Uint8Array(bytes.byteLength);
        blobBytes.set(bytes);
        const blob = new Blob([blobBytes.buffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      const skipped = highlights.length - exportableCount;
      showActionNotice(skipped > 0 ? `已导出 ${exportableCount} 条高亮，${skipped} 条无法定位` : `已导出 ${exportableCount} 条标准 PDF 高亮`);
    } catch (reason) {
      showActionNotice(`导出失败：${pdfErrorMessage(reason)}`);
    } finally {
      setAnnotatedPdfExporting(false);
    }
  }, [annotatedPdfExporting, clearActionNotice, entry, highlights, pdf, showActionNotice]);

  const removeBookmark = useCallback(async (id: string) => {
    try {
      await deleteLocalPdfBookmark(id);
      setBookmarks((current) => current.filter((bookmark) => bookmark.id !== id));
    } catch (reason) {
      showActionNotice(`删除书签失败：${pdfErrorMessage(reason)}`);
    }
  }, [showActionNotice]);

  const jumpToDestination = useCallback(async (destination: string | unknown[] | null) => {
    if (!pdf || !destination) return;
    try {
      const explicit = typeof destination === "string"
        ? await pdf.getDestination(destination)
        : destination;
      const reference = explicit?.[0];
      if (!reference) return;
      const index = typeof reference === "number"
        ? reference
        : await pdf.getPageIndex(reference as { num: number; gen: number });
      changePage(index + 1);
      if (window.matchMedia("(max-width: 768px)").matches) setOutlineOpen(false);
    } catch (reason) {
      showActionNotice(`目录跳转失败：${pdfErrorMessage(reason)}`);
    }
  }, [changePage, pdf, showActionNotice]);

  const getPageText = useCallback(async (pageNumber: number): Promise<PageTextCache> => {
    const cached = textCacheRef.current.get(pageNumber);
    if (cached) return cached;
    if (!pdf) throw new Error("PDF 尚未加载");
    const pdfPage = await pdf.getPage(pageNumber);
    const content = await pdfPage.getTextContent();
    const next = pageTextCache(content.items.map((item) => ("str" in item ? item.str : "")));
    textCacheRef.current.set(pageNumber, next);
    return next;
  }, [pdf]);

  const search = useCallback(async (direction: 1 | -1) => {
    if (!pdf || !searchQuery.trim() || searching) return;
    clearActionNotice();
    const requestId = ++searchRequestRef.current;
    const query = searchQuery.trim().toLocaleLowerCase();
    setSearching(true);
    setSearchStatus("正在搜索…");
    try {
      let matches = searchMatches;
      let nextIndex: number;
      if (query !== completedSearchQuery) {
        matches = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const cached = await getPageText(pageNumber);
          if (requestId !== searchRequestRef.current) return;
          let offset = cached.text.indexOf(query);
          while (offset >= 0) {
            matches.push({ page: pageNumber, offset });
            offset = cached.text.indexOf(query, offset + Math.max(1, query.length));
          }
          if (pageNumber % 8 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          if (pageNumber % 8 === 0 && requestId === searchRequestRef.current) {
            setSearchStatus(`正在搜索 ${pageNumber}/${pdf.numPages} 页…`);
          }
        }
        if (requestId !== searchRequestRef.current) return;
        setCompletedSearchQuery(query);
        setSearchMatches(matches);
        if (matches.length === 0) {
          setActiveSearchIndex(-1);
          setSearchStatus("未找到");
          return;
        }
        const atOrAfterCurrent = matches.findIndex((match) => match.page >= page);
        nextIndex = direction === 1
          ? (atOrAfterCurrent >= 0 ? atOrAfterCurrent : 0)
          : (atOrAfterCurrent > 0 ? atOrAfterCurrent - 1 : matches.length - 1);
      } else if (matches.length > 0) {
        nextIndex = (activeSearchIndex + direction + matches.length) % matches.length;
      } else {
        setSearchStatus("未找到");
        return;
      }
      const match = matches[nextIndex];
      setActiveSearchIndex(nextIndex);
      changePage(match.page);
      setSearchStatus(`${nextIndex + 1}/${matches.length} · 第 ${match.page} 页`);
    } catch (reason) {
      if (requestId === searchRequestRef.current) setSearchStatus(`搜索失败：${pdfErrorMessage(reason)}`);
    } finally {
      if (requestId === searchRequestRef.current) setSearching(false);
    }
  }, [activeSearchIndex, changePage, clearActionNotice, completedSearchQuery, getPageText, page, pdf, searchMatches, searchQuery, searching]);

  useEffect(() => {
    const query = completedSearchQuery;
    const queryMatches = searchMatches
      .map((match, index) => ({ ...match, resultIndex: index }));
    const layers = Array.from(textLayerRefs.current.entries());
    let activeMark: HTMLElement | null = null;
    let targetMark: HTMLElement | null = null;
    layers.forEach(([pageNumber, layer]) => {
      const cached = textCacheRef.current.get(pageNumber);
      const divs = layer.textDivs;
      if (!cached || !divs.length) return;
      const pageMatches = queryMatches.filter((match) => match.page === pageNumber);
      const pageHighlights = highlights.filter((highlight) => highlight.page === pageNumber);
      const markedHighlights = initialTargetRange?.page === pageNumber && targetHighlightId && !pageHighlights.some((highlight) => highlight.id === targetHighlightId)
        ? [...pageHighlights, {
          id: targetHighlightId,
          pdfId: documentId,
          page: pageNumber,
          start: initialTargetRange.start,
          end: initialTargetRange.end,
          text: "",
          color: "yellow",
          createdAt: "",
        }]
        : pageHighlights;
      const visibleHighlights = markedHighlights.filter(
        (highlight) => showHighlights || highlight.id === targetHighlightId,
      );
      cached.items.forEach((item, itemIndex) => {
        const div = divs[itemIndex];
        if (!div) return;
        div.textContent = item;
        if (!item) return;
        const itemStart = cached.starts[itemIndex];
        const searchRanges = query ? pageMatches
          .map((match) => ({
            start: Math.max(0, match.offset - itemStart),
            end: Math.min(item.length, match.offset + query.length - itemStart),
            resultIndex: match.resultIndex,
          }))
          .filter((range) => range.start < range.end) : [];
        const highlightRanges = visibleHighlights
          .map((highlight) => ({
            start: Math.max(0, highlight.start - itemStart),
            end: Math.min(item.length, highlight.end - itemStart),
            highlight,
          }))
          .filter((range) => range.start < range.end);
        if (searchRanges.length === 0 && highlightRanges.length === 0) return;
        const boundaries = new Set<number>([0, item.length]);
        searchRanges.forEach((range) => { boundaries.add(range.start); boundaries.add(range.end); });
        highlightRanges.forEach((range) => { boundaries.add(range.start); boundaries.add(range.end); });
        const points = [...boundaries].sort((left, right) => left - right);
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < points.length - 1; index++) {
          const start = points[index];
          const end = points[index + 1];
          if (start >= end) continue;
          const searchRange = searchRanges.find((range) => range.start <= start && range.end >= end);
          const highlightRange = highlightRanges.find((range) => range.start <= start && range.end >= end);
          if (!searchRange && !highlightRange) {
            fragment.append(item.slice(start, end));
            continue;
          }
          const mark = document.createElement("mark");
          const classes: string[] = [];
          if (highlightRange) {
            classes.push("pdf-annotation-highlight");
            mark.dataset.highlightId = highlightRange.highlight.id;
            if (highlightRange.highlight.id === targetHighlightId) classes.push("pdf-highlight-target");
          }
          if (searchRange) {
            classes.push(searchRange.resultIndex === activeSearchIndex ? "pdf-search-current" : "pdf-search-hit");
          }
          mark.className = classes.join(" ");
          mark.textContent = item.slice(start, end);
          fragment.append(mark);
          if (searchRange?.resultIndex === activeSearchIndex) activeMark = mark;
          if (highlightRange?.highlight.id === targetHighlightId) targetMark = mark;
        }
        div.replaceChildren(fragment);
      });
    });
    const reveal = targetMark ?? activeMark;
    if (reveal) {
      window.requestAnimationFrame(() => (reveal as HTMLElement).scrollIntoView({ block: "center", inline: "center" }));
    }
    if (!targetMark) return;
    const timer = window.setTimeout(() => setTargetHighlightId((current) => current === targetHighlightId ? null : current), 2400);
    return () => window.clearTimeout(timer);
  }, [activeSearchIndex, completedSearchQuery, documentId, highlights, initialTargetRange, searchMatches, showHighlights, targetHighlightId, textLayerRevision]);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLElement>) => {
    if (event.touches.length === 2) {
      const first = event.touches[0];
      const second = event.touches[1];
      const surface = pageSurfaceRefs.current.get(page);
      if (!surface) return;
      const bounds = surface.getBoundingClientRect();
      const centerX = (first.clientX + second.clientX) / 2;
      const centerY = (first.clientY + second.clientY) / 2;
      pinchGestureRef.current = {
        initialDistance: Math.max(1, touchDistance(first, second)),
        initialZoom: zoom,
        targetZoom: zoom,
        anchorX: Math.max(0, Math.min(1, (centerX - bounds.left) / Math.max(1, bounds.width))),
        anchorY: Math.max(0, Math.min(1, (centerY - bounds.top) / Math.max(1, bounds.height))),
      };
      touchGestureRef.current = null;
      event.preventDefault();
      return;
    }
    if (event.touches.length !== 1) {
      touchGestureRef.current = null;
      return;
    }
    const touch = event.touches[0];
    const viewport = viewportRef.current;
    const maxScroll = viewport ? Math.max(0, viewport.scrollWidth - viewport.clientWidth) : 0;
    touchGestureRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      startedAt: performance.now(),
      atLeft: viewMode === "horizontal" ? !viewport || viewport.scrollLeft <= 2 : false,
      atRight: viewMode === "horizontal" ? !viewport || viewport.scrollLeft >= maxScroll - 2 : false,
    };
  }, [page, viewMode, zoom]);

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLElement>) => {
    const pinch = pinchGestureRef.current;
    if (!pinch || event.touches.length < 2) return;
    event.preventDefault();
    const distance = touchDistance(event.touches[0], event.touches[1]);
    pinch.targetZoom = Math.max(0.25, Math.min(4, pinch.initialZoom * distance / pinch.initialDistance));
    const surface = pageSurfaceRefs.current.get(page);
    if (!surface) return;
    surface.style.transformOrigin = `${pinch.anchorX * 100}% ${pinch.anchorY * 100}%`;
    surface.style.transform = `scale(${pinch.targetZoom / Math.max(0.25, pinch.initialZoom)})`;
  }, [page]);

  const finishPinch = useCallback(() => {
    const pinch = pinchGestureRef.current;
    if (!pinch) return false;
    pinchGestureRef.current = null;
    const surface = pageSurfaceRefs.current.get(page);
    if (surface) {
      surface.style.transform = "";
      surface.style.transformOrigin = "";
    }
    zoomAnchorRef.current = { x: pinch.anchorX, y: pinch.anchorY };
    setFitWidth(false);
    setFitHeight(false);
    setZoom(pinch.targetZoom);
    return true;
  }, [page]);

  const handleTouchEnd = useCallback((event: React.TouchEvent<HTMLElement>) => {
    if (pinchGestureRef.current && event.touches.length < 2) {
      event.preventDefault();
      finishPinch();
      touchGestureRef.current = null;
      return;
    }
    const gesture = touchGestureRef.current;
    touchGestureRef.current = null;
    const touch = event.changedTouches[0];
    if (!gesture || !touch) return;
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    const duration = performance.now() - gesture.startedAt;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;

    if (
      viewMode === "horizontal"
      && duration < 700
      && Math.abs(dx) >= 52
      && Math.abs(dx) > Math.abs(dy) * 1.25
    ) {
      const viewport = viewportRef.current;
      const maxScroll = viewport ? Math.max(0, viewport.scrollWidth - viewport.clientWidth) : 0;
      const atLeft = gesture.atLeft || !viewport || viewport.scrollLeft <= 2;
      const atRight = gesture.atRight || !viewport || viewport.scrollLeft >= maxScroll - 2;
      if (dx < 0 && atRight) changePage(page + 1);
      else if (dx > 0 && atLeft) changePage(page - 1);
      return;
    }

  }, [changePage, finishPinch, page, viewMode]);

  const handleTouchCancel = useCallback(() => {
    touchGestureRef.current = null;
    if (!pinchGestureRef.current) return;
    pinchGestureRef.current = null;
    const surface = pageSurfaceRefs.current.get(page);
    if (surface) {
      surface.style.transform = "";
      surface.style.transformOrigin = "";
    }
  }, [page]);

  const handlePageClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!fullscreen || event.detail > 1) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    setFullscreenControlsVisible((visible) => !visible);
  }, [fullscreen]);

  const renderOutline = (items: OutlineItem[], depth = 0) => items.map((item, index) => (
    <div className="pdf-outline-node" key={`${depth}-${index}-${item.title}`}>
      <button
        type="button"
        style={{ paddingInlineStart: `${10 + depth * 14}px` }}
        onClick={() => void jumpToDestination(item.dest)}
        disabled={!item.dest}
        title={item.title}
      >{item.title || "未命名章节"}</button>
      {item.items?.length > 0 && renderOutline(item.items, depth + 1)}
    </div>
  ));

  useEffect(() => {
    if (!outlineOpen || outlineMode !== "pages") return;
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`.pdf-page-directory [data-pdf-page="${page}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }, [outlineMode, outlineOpen, page]);

  useEffect(() => {
    if (!pdf || viewMode !== "vertical") return;
    const target = pageSurfaceRefs.current.get(page);
    if (!target) return;
    window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewport.scrollTo({
        top: Math.max(0, target.offsetTop - 12),
        left: Math.max(0, target.offsetLeft - 12),
      });
    });
  }, [page, viewMode, pdf]);

  return (
    <div
      ref={readerRef}
      className={`pdf-reader ${fullscreen ? "pdf-reader-fullscreen" : ""} ${immersiveFallback ? "pdf-reader-immersive" : ""} ${fullscreen && !fullscreenControlsVisible ? "pdf-fullscreen-controls-hidden" : ""}`}
      aria-label="PDF 阅读器"
    >
      <header className="pdf-reader-toolbar">
        <button type="button" className="pdf-reader-close" onClick={() => void closeReader()} title="返回 Nine Rings">←</button>
        <span className="pdf-reader-title" title={entry?.name}>{entry?.name ?? "PDF 阅读器"}</span>
        {pdf && (
          <button
            type="button"
            className={outlineOpen ? "active" : undefined}
            aria-expanded={outlineOpen}
            onClick={() => setOutlineOpen((open) => !open)}
          >目录</button>
        )}
        {pdf && (
          <button
            type="button"
            className={currentPageBookmark ? "pdf-page-bookmark active" : "pdf-page-bookmark"}
            onClick={() => void togglePageBookmark()}
            aria-label={currentPageBookmark ? `取消第 ${page} 页书签` : `添加第 ${page} 页书签`}
            title={currentPageBookmark ? "取消当前页书签" : "添加当前页书签"}
          >🔖</button>
        )}
        <button
          type="button"
          className={fullscreen ? "pdf-fullscreen-button active" : "pdf-fullscreen-button"}
          onClick={() => void toggleFullscreen()}
          aria-label={fullscreen ? "退出全屏阅读" : "进入全屏阅读"}
          title={fullscreen ? "退出全屏阅读（Esc）" : "进入全屏阅读"}
        >{fullscreen ? "⤢" : "⛶"}</button>
        <div className="pdf-page-controls">
          <button type="button" onClick={() => changePage(page - 1)} disabled={!pdf || page <= 1}>‹</button>
          <input
            aria-label="PDF 页码"
            inputMode="numeric"
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))}
            onBlur={() => changePage(Number(pageInput))}
            onKeyDown={(event) => { if (event.key === "Enter") changePage(Number(pageInput)); }}
          />
          <span>/ {pdf?.numPages ?? "—"}</span>
          <button type="button" onClick={() => changePage(page + 1)} disabled={!pdf || page >= pdf.numPages}>›</button>
        </div>
        <div className="pdf-zoom-controls">
          <button type="button" onClick={() => { setFitWidth(false); setFitHeight(false); setZoom((value) => Math.max(0.25, value - 0.15)); }}>−</button>
          <button type="button" className={fitWidth ? "active" : undefined} onClick={() => { setFitWidth(true); setFitHeight(false); }}>适宽</button>
          <button type="button" onClick={() => { setFitWidth(false); setFitHeight(false); setZoom((value) => Math.min(4, value + 0.15)); }}>＋</button>
          <button type="button" className={fitHeight ? "active" : undefined} onClick={() => { setFitHeight(true); setFitWidth(false); }}>适高</button>
          <button type="button" className={showHighlights ? "active" : undefined} onClick={() => setShowHighlights((value) => !value)} title="显示/隐藏高亮标注">
            高亮
          </button>
          <button
            type="button"
            onClick={() => void exportAnnotatedPdf()}
            disabled={!pdf || highlights.length === 0 || annotatedPdfExporting}
            title="将当前高亮写入新的标准 PDF 文件"
          >{annotatedPdfExporting ? "导出中…" : "导出批注"}</button>
        </div>
        <div className="pdf-view-mode-controls">
          <button type="button" className={viewMode === "horizontal" ? "active" : undefined} onClick={() => setViewMode("horizontal")}>横向</button>
          <button type="button" className={viewMode === "vertical" ? "active" : undefined} onClick={() => setViewMode("vertical")}>纵向</button>
        </div>
        <form className="pdf-search" onSubmit={(event) => { event.preventDefault(); void search(1); }}>
          <input
            ref={searchInputRef}
            type="search"
            aria-label="搜索 PDF"
            placeholder="搜索 PDF…"
            value={searchQuery}
            onChange={(event) => {
              searchRequestRef.current += 1;
              setSearchQuery(event.target.value);
              setSearching(false);
              setSearchStatus("");
              setCompletedSearchQuery("");
              setSearchMatches([]);
              setActiveSearchIndex(-1);
            }}
          />
          <button type="button" aria-label="上一个搜索结果" onClick={() => void search(-1)} disabled={!pdf || searching || !searchQuery.trim()}>↑</button>
          <button type="submit" aria-label="下一个搜索结果" disabled={!pdf || searching || !searchQuery.trim()}>↓</button>
          {(actionNotice || searchStatus) && <span role="status" aria-live="polite">{actionNotice || searchStatus}</span>}
        </form>
      </header>

      <div className="pdf-reader-body">
        {outlineOpen && pdf && (
          <aside className="pdf-outline" aria-label="PDF 目录">
            <div className="pdf-outline-heading">
              <div className="pdf-outline-tabs">
                {outline.length > 0 && (
                  <button
                    type="button"
                    className={outlineMode === "outline" ? "active" : undefined}
                    onClick={() => setOutlineMode("outline")}
                  >目录</button>
                )}
                <button
                  type="button"
                  className={outlineMode === "pages" ? "active" : undefined}
                  onClick={() => setOutlineMode("pages")}
                >页面</button>
                <button
                  type="button"
                  className={outlineMode === "highlights" ? "active" : undefined}
                  onClick={() => setOutlineMode("highlights")}
                >高亮{highlights.length > 0 ? ` ${highlights.length}` : ""}</button>
                <button
                  type="button"
                  className={outlineMode === "bookmarks" ? "active" : undefined}
                  onClick={() => setOutlineMode("bookmarks")}
                >书签{bookmarks.length > 0 ? ` ${bookmarks.length}` : ""}</button>
              </div>
              <button type="button" onClick={() => setOutlineOpen(false)} aria-label="关闭目录">×</button>
            </div>
            <div className="pdf-outline-list">
              {outlineMode === "outline" && outline.length > 0 ? renderOutline(outline) : outlineMode === "highlights" ? (
                <div className="pdf-annotation-directory">
                  {highlights.length === 0 ? <p>还没有高亮。选择页面文字后点击“高亮”。</p> : highlights.map((highlight) => (
                    <div className="pdf-annotation-item" key={highlight.id}>
                      <button type="button" onClick={() => jumpToHighlight(highlight)} title={highlight.text}>
                        <strong>第 {highlight.page} 页</strong>
                        <span>{highlight.text}</span>
                      </button>
                      <button type="button" className="pdf-annotation-delete" onClick={() => void removeHighlight(highlight.id)} aria-label={`删除第 ${highlight.page} 页高亮`}>×</button>
                    </div>
                  ))}
                </div>
              ) : outlineMode === "bookmarks" ? (
                <div className="pdf-annotation-directory">
                  {bookmarks.length === 0 ? <p>还没有书签。点击工具栏中的 🔖 标记当前页。</p> : bookmarks.map((bookmark) => (
                    <div className="pdf-annotation-item" key={bookmark.id}>
                      <button type="button" onClick={() => {
                        changePage(bookmark.page);
                        if (window.matchMedia("(max-width: 768px)").matches) setOutlineOpen(false);
                      }} title={bookmark.label}>
                        <strong>第 {bookmark.page} 页</strong>
                        <span>{bookmark.label}</span>
                      </button>
                      <button type="button" className="pdf-annotation-delete" onClick={() => void removeBookmark(bookmark.id)} aria-label={`删除第 ${bookmark.page} 页书签`}>×</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pdf-page-directory">
                  {Array.from({ length: pdf.numPages }, (_, index) => {
                    const pageNumber = index + 1;
                    return (
                      <button
                        type="button"
                        className={pageNumber === page ? "active" : undefined}
                        data-pdf-page={pageNumber}
                        key={pageNumber}
                        onClick={() => {
                          changePage(pageNumber);
                          if (window.matchMedia("(max-width: 768px)").matches) setOutlineOpen(false);
                        }}
                      >
                        <span>{pageLabels?.[index] ?? pageNumber}</span>
                        <small>第 {pageNumber} 页</small>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        )}
        <main
          className={`pdf-page-viewport ${viewMode === "vertical" ? "pdf-page-viewport-vertical" : ""}`}
          ref={viewportRef}
          onClick={handlePageClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
        >
          {loading && <div className="pdf-reader-message">正在打开 PDF…</div>}
          {error && (
            <div className="pdf-reader-message pdf-reader-error">
              <strong>无法打开 PDF</strong>
              <span>{error}</span>
              <button type="button" onClick={() => void closeReader()}>返回</button>
            </div>
          )}
          {!error && displayedPages.map((pageNumber) => (
            <div
              className={`pdf-page-surface ${renderedPages.includes(pageNumber) ? "" : "pdf-page-placeholder"}`}
              key={pageNumber}
              data-pdf-page={pageNumber}
              data-pdf-mode={viewMode}
              ref={pageSurfaceRefForPage(pageNumber)}
            >
              {renderedPages.includes(pageNumber) && (
                <>
                  <canvas ref={canvasRefForPage(pageNumber)} />
                  <div ref={textLayerRefForPage(pageNumber)} className="pdf-text-layer textLayer" />
                </>
              )}
            </div>
          ))}
        </main>
      </div>
      {selectionAnchor && (
        <div className="pdf-selection-actions">
          <span>{selectionAnchor.text.length} 字</span>
          <button type="button" disabled={highlightSaving || excerptSaving} onPointerDown={(event) => event.preventDefault()} onClick={() => void saveHighlight()}>
            {highlightSaving ? "保存中…" : "高亮"}
          </button>
          {onCreateExcerpt && <button
            type="button"
            disabled={excerptSaving || highlightSaving}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void createExcerpt()}
          >{excerptSaving ? "正在摘录…" : "摘录到笔记"}</button>}
        </div>
      )}
    </div>
  );
}

export default PdfReader;
