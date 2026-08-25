import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  PasswordResponses,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  getLocalPdf,
  updateLocalPdfProgress,
  type LocalPdfEntry,
} from "../lib/pdf-library";
import { toggleTauriFullscreen } from "../lib/fullscreen";
import { isTauriRuntime } from "../lib/runtime";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface Props {
  documentId: string;
  onClose: () => void;
  onFullscreenChange?: (fullscreen: boolean) => void;
}

interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineItem[];
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

export function PdfReader({ documentId, onClose, onFullscreenChange }: Props) {
  const readerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const textCacheRef = useRef(new Map<number, string>());
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchStatus, setSearchStatus] = useState("");
  const [fullscreen, setFullscreen] = useState(false);

  const applyFullscreenState = useCallback((next: boolean) => {
    setFullscreen(next);
    onFullscreenChange?.(next);
  }, [onFullscreenChange]);

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
      } else if (element?.webkitRequestFullscreen) {
        await element.webkitRequestFullscreen();
      } else {
        setSearchStatus("当前浏览器不支持全屏；安装到桌面后可获得全屏体验");
      }
    } catch (reason) {
      setSearchStatus(`全屏切换失败：${pdfErrorMessage(reason)}`);
    }
  }, [applyFullscreenState, exitFullscreen]);

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
      const stored = await getLocalPdf(documentId);
      if (!stored) throw new Error("PDF 不存在或已经被删除");
      if (cancelled) return;
      setEntry(stored.entry);
      setPage(Math.max(1, stored.entry.page));
      setPageInput(String(Math.max(1, stored.entry.page)));
      setZoom(stored.entry.zoom || 1);
      setFitWidth(stored.entry.fitWidth !== false);

      const loadingTask = getDocument({ data: await stored.blob.arrayBuffer() });
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
      const documentOutline = await loadedDocument.getOutline();
      if (!cancelled) setOutline((documentOutline ?? []) as OutlineItem[]);
    };
    void open()
      .catch((reason) => { if (!cancelled) setError(pdfErrorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      void loadedDocument?.destroy();
    };
  }, [documentId]);

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
    if (!pdf || !canvasRef.current || viewportWidth <= 0) return;
    let cancelled = false;
    renderTaskRef.current?.cancel();
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
      const task = pdfPage.render({
        canvasContext: context,
        viewport: displayViewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        background: "rgb(255,255,255)",
      });
      renderTaskRef.current = task;
      await task.promise;
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
      if (!pdf || event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setPage((current) => Math.max(1, current - 1));
      } else if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        setPage((current) => Math.min(pdf.numPages, current + 1));
      } else if (event.key === "Escape") {
        if (fullscreen) void exitFullscreen();
        else void closeReader();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeReader, exitFullscreen, fullscreen, pdf]);

  useEffect(() => setPageInput(String(page)), [page]);

  const changePage = useCallback((nextPage: number) => {
    if (!pdf) return;
    setPage(clampPage(nextPage, pdf.numPages));
  }, [pdf]);

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

  const searchNext = useCallback(async () => {
    if (!pdf || !searchQuery.trim() || searching) return;
    const query = searchQuery.trim().toLocaleLowerCase();
    setSearching(true);
    setSearchStatus("正在搜索…");
    try {
      for (let offset = 0; offset < pdf.numPages; offset++) {
        const candidate = ((page - 1 + offset) % pdf.numPages) + 1;
        let text = textCacheRef.current.get(candidate);
        if (text === undefined) {
          const pdfPage = await pdf.getPage(candidate);
          const content = await pdfPage.getTextContent();
          text = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .toLocaleLowerCase();
          textCacheRef.current.set(candidate, text);
        }
        if (text.includes(query)) {
          changePage(candidate);
          setSearchStatus(`第 ${candidate} 页`);
          return;
        }
      }
      setSearchStatus("未找到");
    } catch (reason) {
      setSearchStatus(`搜索失败：${pdfErrorMessage(reason)}`);
    } finally {
      setSearching(false);
    }
  }, [changePage, page, pdf, searchQuery, searching]);

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

  return (
    <div
      ref={readerRef}
      className={`pdf-reader ${fullscreen ? "pdf-reader-fullscreen" : ""}`}
      aria-label="PDF 阅读器"
    >
      <header className="pdf-reader-toolbar">
        <button type="button" className="pdf-reader-close" onClick={() => void closeReader()} title="返回 Nine Rings">←</button>
        <span className="pdf-reader-title" title={entry?.name}>{entry?.name ?? "PDF 阅读器"}</span>
        {outline.length > 0 && (
          <button
            type="button"
            className={outlineOpen ? "active" : undefined}
            aria-expanded={outlineOpen}
            onClick={() => setOutlineOpen((open) => !open)}
          >目录</button>
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
        <form className="pdf-search" onSubmit={(event) => { event.preventDefault(); void searchNext(); }}>
          <input
            type="search"
            aria-label="搜索 PDF"
            placeholder="搜索 PDF…"
            value={searchQuery}
            onChange={(event) => { setSearchQuery(event.target.value); setSearchStatus(""); }}
          />
          <button type="submit" disabled={!pdf || searching || !searchQuery.trim()}>查找</button>
          {searchStatus && <span>{searchStatus}</span>}
        </form>
      </header>

      <div className="pdf-reader-body">
        {outlineOpen && outline.length > 0 && (
          <aside className="pdf-outline" aria-label="PDF 目录">
            <div className="pdf-outline-heading">
              <strong>目录</strong>
              <button type="button" onClick={() => setOutlineOpen(false)} aria-label="关闭目录">×</button>
            </div>
            <div className="pdf-outline-list">{renderOutline(outline)}</div>
          </aside>
        )}
        <main className="pdf-page-viewport" ref={viewportRef}>
          {loading && <div className="pdf-reader-message">正在打开 PDF…</div>}
          {error && (
            <div className="pdf-reader-message pdf-reader-error">
              <strong>无法打开 PDF</strong>
              <span>{error}</span>
              <button type="button" onClick={() => void closeReader()}>返回</button>
            </div>
          )}
          {!error && <canvas ref={canvasRef} className={rendering ? "pdf-page-rendering" : ""} />}
          {rendering && !loading && <span className="pdf-render-status">正在渲染第 {page} 页…</span>}
        </main>
      </div>
    </div>
  );
}

export default PdfReader;
