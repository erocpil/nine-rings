import { useCallback, useEffect, useRef, useState } from "react";
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

export function PdfReader({ documentId, onClose, onFullscreenChange, initialHighlightId, initialTargetRange, onCreateExcerpt }: Props) {
  const readerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageSurfaceRef = useRef<HTMLDivElement>(null);
  const textLayerElementRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<TextLayer | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const textCacheRef = useRef(new Map<number, PageTextCache>());
  const touchGestureRef = useRef<TouchGesture | null>(null);
  const pinchGestureRef = useRef<PinchGesture | null>(null);
  const lastTapRef = useRef(0);
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const searchRequestRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const latestProgressRef = useRef<{
    id: string;
    page: number;
    zoom: number;
    fitWidth: boolean;
    pageCount: number;
  } | null>(null);
  const [entry, setEntry] = useState<LocalPdfEntry | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(0);
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
      const layer = textLayerElementRef.current;
      if (!selection || selection.isCollapsed || !layer) {
        setSelectionAnchor(null);
        return;
      }
      const anchor = selection.anchorNode;
      const focus = selection.focusNode;
      if (!anchor || !focus || !layer.contains(anchor) || !layer.contains(focus)) {
        setSelectionAnchor(null);
        return;
      }
      const cached = textCacheRef.current.get(page);
      const divs = textLayerRef.current?.textDivs;
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
  }, [page, textLayerRevision]);

  const ensureSelectionHighlight = useCallback(async () => {
    if (!entry || !selectionAnchor) throw new Error("请先选择 PDF 文本");
    const existing = highlights.find((highlight) => (
      highlight.page === page
      && highlight.start === selectionAnchor.start
      && highlight.end === selectionAnchor.end
    ));
    if (existing) return { highlight: existing, created: false };
    const highlight = await addLocalPdfHighlight({
      pdfId: entry.id,
      page,
      start: selectionAnchor.start,
      end: selectionAnchor.end,
      text: selectionAnchor.text,
    });
    setHighlights((current) => [...current, highlight]);
    return { highlight, created: true };
  }, [entry, highlights, page, selectionAnchor]);

  const saveHighlight = useCallback(async () => {
    if (!selectionAnchor || highlightSaving) return;
    setHighlightSaving(true);
    try {
      await ensureSelectionHighlight();
      window.getSelection()?.removeAllRanges();
      setSelectionAnchor(null);
      setSearchStatus("已保存高亮");
    } catch (reason) {
      setSearchStatus(`高亮失败：${pdfErrorMessage(reason)}`);
    } finally {
      setHighlightSaving(false);
    }
  }, [ensureSelectionHighlight, highlightSaving, selectionAnchor]);

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
        page,
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
      setSearchStatus(`摘录失败：${pdfErrorMessage(reason)}`);
    } finally {
      setExcerptSaving(false);
    }
  }, [ensureSelectionHighlight, entry, excerptSaving, onCreateExcerpt, page, selectionAnchor]);

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
      else setSearchStatus(`全屏切换失败：${pdfErrorMessage(reason)}`);
    }
  }, [applyFullscreenState, enterImmersiveFallback, exitFullscreen, fullscreen]);

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
    const open = async () => {
      setLoading(true);
      setError(null);
      textCacheRef.current.clear();
      setSearchMatches([]);
      setActiveSearchIndex(-1);
      setHighlights([]);
      setBookmarks([]);
      setTargetHighlightId(initialHighlightId ?? (initialTargetRange ? "pdf-source-target" : null));
      const stored = await getLocalPdf(documentId);
      if (!stored) throw new Error("PDF 不存在或已经被删除");
      if (cancelled) return;
      setEntry(stored.entry);
      setPage(Math.max(1, stored.entry.page));
      setPageInput(String(Math.max(1, stored.entry.page)));
      setZoom(stored.entry.zoom || 1);
      setFitWidth(stored.entry.fitWidth !== false);

      const [data, storedHighlights, storedBookmarks] = await Promise.all([
        stored.blob.arrayBuffer(),
        listLocalPdfHighlights(documentId),
        listLocalPdfBookmarks(documentId),
      ]);
      if (cancelled) return;
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
      if (cancelled) {
        await loadedDocument.destroy();
        return;
      }
      setPdf(loadedDocument);
      const restoredPage = clampPage(stored.entry.page, loadedDocument.numPages);
      setPage(restoredPage);
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
      renderTaskRef.current?.cancel();
      textLayerRef.current?.cancel();
      void loadedDocument?.destroy();
    };
  }, [documentId, initialHighlightId, initialTargetRange]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => setViewportWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !textLayerElementRef.current || viewportWidth <= 0) return;
    let cancelled = false;
    renderTaskRef.current?.cancel();
    textLayerRef.current?.cancel();
    const render = async () => {
      setRendering(true);
      const pdfPage = await pdf.getPage(page);
      if (cancelled) return;
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const availableWidth = Math.max(160, viewportWidth - 24);
      const displayScale = fitWidth
        ? Math.max(0.25, Math.min(4, availableWidth / baseViewport.width))
        : zoom;
      const displayViewport = pdfPage.getViewport({ scale: displayScale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2.5);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("当前环境不支持 Canvas PDF 渲染");
      canvas.width = Math.max(1, Math.floor(displayViewport.width * outputScale));
      canvas.height = Math.max(1, Math.floor(displayViewport.height * outputScale));
      canvas.style.width = `${Math.floor(displayViewport.width)}px`;
      canvas.style.height = `${Math.floor(displayViewport.height)}px`;
      const surface = pageSurfaceRef.current;
      const textLayerElement = textLayerElementRef.current;
      if (!surface || !textLayerElement) return;
      surface.style.width = `${Math.floor(displayViewport.width)}px`;
      surface.style.height = `${Math.floor(displayViewport.height)}px`;
      surface.style.setProperty("--scale-factor", String(displayScale));
      textLayerElement.replaceChildren();
      const task = pdfPage.render({
        canvasContext: context,
        viewport: displayViewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        background: "rgb(255,255,255)",
      });
      renderTaskRef.current = task;
      const textContent = await pdfPage.getTextContent();
      const textItems = textContent.items.map((item) => ("str" in item ? item.str : ""));
      textCacheRef.current.set(page, pageTextCache(textItems));
      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textLayerElement,
        viewport: displayViewport,
      });
      textLayerRef.current = textLayer;
      await Promise.all([task.promise, textLayer.render()]);
      if (!cancelled) setTextLayerRevision((revision) => revision + 1);
      const anchor = zoomAnchorRef.current;
      if (!cancelled && anchor) {
        zoomAnchorRef.current = null;
        window.requestAnimationFrame(() => {
          const scrollViewport = viewportRef.current;
          const nextSurface = pageSurfaceRef.current;
          if (!scrollViewport || !nextSurface) return;
          scrollViewport.scrollLeft = anchor.x * nextSurface.clientWidth - scrollViewport.clientWidth / 2;
          scrollViewport.scrollTop = anchor.y * nextSurface.clientHeight - scrollViewport.clientHeight / 2;
        });
      }
      if (!cancelled && fitWidth) setZoom(displayScale);
    };
    void render()
      .catch((reason) => {
        if (!cancelled && (reason as { name?: string })?.name !== "RenderingCancelledException") {
          setError(pdfErrorMessage(reason));
        }
      })
      .finally(() => { if (!cancelled) setRendering(false); });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      textLayerRef.current?.cancel();
    };
  }, [fitWidth, page, pdf, viewportWidth, zoom]);

  useEffect(() => {
    if (!pdf || !entry) return;
    latestProgressRef.current = {
      id: entry.id,
      page,
      zoom,
      fitWidth,
      pageCount: pdf.numPages,
    };
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void updateLocalPdfProgress(entry.id, { page, zoom, fitWidth, pageCount: pdf.numPages })
        .catch((reason) => console.warn("[PDF] 保存阅读进度失败:", reason));
      saveTimerRef.current = null;
    }, 400);
  }, [entry, fitWidth, page, pdf, zoom]);

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
        setZoom((value) => Math.min(4, value + 0.15));
      } else if (event.key === "-") {
        event.preventDefault();
        setFitWidth(false);
        setZoom((value) => Math.max(0.25, value - 0.15));
      } else if (event.key === "0") {
        event.preventDefault();
        setFitWidth(true);
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
        setSearchStatus(`已取消第 ${page} 页书签`);
      } else {
        const label = pageLabels?.[page - 1];
        const bookmark = await addLocalPdfBookmark(entry.id, page, label ? `${label} · 第 ${page} 页` : `第 ${page} 页`);
        setBookmarks((current) => [...current, bookmark].sort((left, right) => left.page - right.page));
        setSearchStatus(`已添加第 ${page} 页书签`);
      }
    } catch (reason) {
      setSearchStatus(`书签操作失败：${pdfErrorMessage(reason)}`);
    }
  }, [bookmarks, entry, page, pageLabels]);

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
      setSearchStatus(`删除高亮失败：${pdfErrorMessage(reason)}`);
    }
  }, []);

  const removeBookmark = useCallback(async (id: string) => {
    try {
      await deleteLocalPdfBookmark(id);
      setBookmarks((current) => current.filter((bookmark) => bookmark.id !== id));
    } catch (reason) {
      setSearchStatus(`删除书签失败：${pdfErrorMessage(reason)}`);
    }
  }, []);

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
      setSearchStatus(`目录跳转失败：${pdfErrorMessage(reason)}`);
    }
  }, [changePage, pdf]);

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
  }, [activeSearchIndex, changePage, completedSearchQuery, getPageText, page, pdf, searchMatches, searchQuery, searching]);

  useEffect(() => {
    const layer = textLayerRef.current;
    const cached = textCacheRef.current.get(page);
    if (!layer || !cached) return;
    const divs = layer.textDivs;
    const query = completedSearchQuery;
    const pageMatches = searchMatches
      .map((match, index) => ({ ...match, resultIndex: index }))
      .filter((match) => match.page === page);
    const pageHighlights = highlights.filter((highlight) => highlight.page === page);
    if (
      targetHighlightId
      && initialTargetRange?.page === page
      && !pageHighlights.some((highlight) => highlight.id === targetHighlightId)
    ) {
      pageHighlights.push({
        id: targetHighlightId,
        pdfId: documentId,
        page,
        start: initialTargetRange.start,
        end: initialTargetRange.end,
        text: "",
        color: "yellow",
        createdAt: "",
      });
    }
    let activeMark: HTMLElement | null = null;
    let targetMark: HTMLElement | null = null;
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
      const highlightRanges = pageHighlights
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
    const reveal = targetMark ?? activeMark;
    if (reveal) {
      window.requestAnimationFrame(() => (reveal as HTMLElement).scrollIntoView({ block: "center", inline: "center" }));
    }
    if (!targetMark) return;
    const timer = window.setTimeout(() => setTargetHighlightId((current) => current === targetHighlightId ? null : current), 2400);
    return () => window.clearTimeout(timer);
  }, [activeSearchIndex, completedSearchQuery, documentId, highlights, initialTargetRange, page, searchMatches, targetHighlightId, textLayerRevision]);

  const toggleBoundaryZoom = useCallback((clientX: number, clientY: number) => {
    const surface = pageSurfaceRef.current;
    if (!surface) return;
    const bounds = surface.getBoundingClientRect();
    zoomAnchorRef.current = {
      x: Math.max(0, Math.min(1, (clientX - bounds.left) / Math.max(1, bounds.width))),
      y: Math.max(0, Math.min(1, (clientY - bounds.top) / Math.max(1, bounds.height))),
    };
    if (fitWidth) {
      setFitWidth(false);
      setZoom((value) => Math.min(4, Math.max(1.5, value * 2)));
    } else {
      zoomAnchorRef.current = null;
      setFitWidth(true);
    }
  }, [fitWidth]);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLElement>) => {
    if (event.touches.length === 2) {
      const first = event.touches[0];
      const second = event.touches[1];
      const surface = pageSurfaceRef.current;
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
      lastTapRef.current = 0;
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
      atLeft: !viewport || viewport.scrollLeft <= 2,
      atRight: !viewport || viewport.scrollLeft >= maxScroll - 2,
    };
  }, [zoom]);

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLElement>) => {
    const pinch = pinchGestureRef.current;
    if (!pinch || event.touches.length < 2) return;
    event.preventDefault();
    const distance = touchDistance(event.touches[0], event.touches[1]);
    pinch.targetZoom = Math.max(0.25, Math.min(4, pinch.initialZoom * distance / pinch.initialDistance));
    const surface = pageSurfaceRef.current;
    if (!surface) return;
    surface.style.transformOrigin = `${pinch.anchorX * 100}% ${pinch.anchorY * 100}%`;
    surface.style.transform = `scale(${pinch.targetZoom / Math.max(0.25, pinch.initialZoom)})`;
  }, []);

  const finishPinch = useCallback(() => {
    const pinch = pinchGestureRef.current;
    if (!pinch) return false;
    pinchGestureRef.current = null;
    const surface = pageSurfaceRef.current;
    if (surface) {
      surface.style.transform = "";
      surface.style.transformOrigin = "";
    }
    zoomAnchorRef.current = { x: pinch.anchorX, y: pinch.anchorY };
    setFitWidth(false);
    setZoom(pinch.targetZoom);
    return true;
  }, []);

  const handleTouchEnd = useCallback((event: React.TouchEvent<HTMLElement>) => {
    if (pinchGestureRef.current && event.touches.length < 2) {
      event.preventDefault();
      finishPinch();
      touchGestureRef.current = null;
      lastTapRef.current = 0;
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

    if (duration < 700 && Math.abs(dx) >= 52 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      const viewport = viewportRef.current;
      const maxScroll = viewport ? Math.max(0, viewport.scrollWidth - viewport.clientWidth) : 0;
      const atLeft = gesture.atLeft || !viewport || viewport.scrollLeft <= 2;
      const atRight = gesture.atRight || !viewport || viewport.scrollLeft >= maxScroll - 2;
      if (dx < 0 && atRight) changePage(page + 1);
      else if (dx > 0 && atLeft) changePage(page - 1);
      lastTapRef.current = 0;
      return;
    }

    if (duration < 280 && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      const now = performance.now();
      if (now - lastTapRef.current < 320) {
        lastTapRef.current = 0;
        event.preventDefault();
        toggleBoundaryZoom(touch.clientX, touch.clientY);
      } else {
        lastTapRef.current = now;
      }
    }
  }, [changePage, finishPinch, page, toggleBoundaryZoom]);

  const handleTouchCancel = useCallback(() => {
    touchGestureRef.current = null;
    if (!pinchGestureRef.current) return;
    pinchGestureRef.current = null;
    const surface = pageSurfaceRef.current;
    if (surface) {
      surface.style.transform = "";
      surface.style.transformOrigin = "";
    }
  }, []);

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
          <button type="button" onClick={() => { setFitWidth(false); setZoom((value) => Math.max(0.25, value - 0.15)); }}>−</button>
          <button type="button" className={fitWidth ? "active" : undefined} onClick={() => setFitWidth(true)}>适宽</button>
          <button type="button" onClick={() => { setFitWidth(false); setZoom((value) => Math.min(4, value + 0.15)); }}>＋</button>
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
          {searchStatus && <span>{searchStatus}</span>}
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
          className="pdf-page-viewport"
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
          {!error && (
            <div
              className={rendering ? "pdf-page-surface pdf-page-rendering" : "pdf-page-surface"}
              ref={pageSurfaceRef}
              onDoubleClick={(event) => {
                event.preventDefault();
                toggleBoundaryZoom(event.clientX, event.clientY);
              }}
            >
              <canvas ref={canvasRef} />
              <div ref={textLayerElementRef} className="pdf-text-layer textLayer" />
            </div>
          )}
          {rendering && !loading && <span className="pdf-render-status">正在渲染第 {page} 页…</span>}
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
