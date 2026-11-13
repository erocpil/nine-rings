import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentLoadingTask, type PDFDocumentProxy } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ToolbarIcon } from "./ToolbarIcon";
import "pdfjs-dist/web/pdf_viewer.css";
GlobalWorkerOptions.workerSrc = worker;

/** Read-only, one-page-at-a-time projection; never imports the document library. */
export function FileBrowserPreviewPdf({ blob, fallback }: { blob: Blob; fallback?: ReactNode }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1), [zoom, setZoom] = useState(0);
  const [width, setWidth] = useState(0), [error, setError] = useState(""), [busy, setBusy] = useState(true);
  const viewport = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element); setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    let task: PDFDocumentLoadingTask | undefined;
    // WKWebView's custom tauri: origin can return status 0 for blob URL reads.
    // Feed bytes directly, as the main reader does, instead of issuing a request.
    void (async () => {
      const data = new Uint8Array(await blob.arrayBuffer());
      if (!live) return;
      task = getDocument({ data, cMapUrl: new URL(`${import.meta.env.BASE_URL}pdfjs-cmaps/`, location.href).href, cMapPacked: true, isEvalSupported: false });
      task.onPassword = () => { if (live) { setError("此 PDF 需要密码，请使用系统应用打开。"); setBusy(false); } void task?.destroy().catch(() => {}); };
      const value = await task.promise;
      if (live) { setDoc(value); setPage(1); }
    })().catch(cause => { if (live) { setError(previous => previous || String(cause)); setBusy(false); } });
    return () => { live = false; void task?.destroy().catch(() => {}); };
  }, [blob]);
  useEffect(() => {
    if (!doc || !width) return;
    const box = surface.current!;
    let live = true;
    let cancel = () => {};
    setBusy(true); setError("");
    void (async () => {
      const pdfPage = await doc.getPage(page);
      if (!live) return;
      const base = pdfPage.getViewport({ scale: 1 });
      // Bound decoded pixels even for unusually large pages.
      const scale = Math.min((zoom || Math.max(100, width - 24) / base.width), Math.sqrt(12_000_000 / (base.width * base.height)));
      const view = pdfPage.getViewport({ scale });
      const canvas = document.createElement("canvas"); canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
      const text = document.createElement("div"); text.className = "textLayer";
      box.replaceChildren(canvas, text);
      box.style.width = `${view.width}px`; box.style.height = `${view.height}px`;
      box.style.setProperty("--scale-factor", String(scale)); box.style.setProperty("--total-scale-factor", String(scale));
      const render = pdfPage.render({ canvasContext: canvas.getContext("2d")!, viewport: view });
      const layer = new TextLayer({ textContentSource: pdfPage.streamTextContent(), container: text, viewport: view });
      cancel = () => { render.cancel(); layer.cancel(); };
      await render.promise;
      if (!live) { layer.cancel(); return; }
      await layer.render();
      if (live) setBusy(false);
    })().catch(cause => { if (live) { setError(String(cause)); setBusy(false); } });
    return () => { live = false; cancel(); box.replaceChildren(); };
  }, [doc, page, width, zoom]);
  return <div className="file-browser-pdf-preview">
    <div className="file-browser-preview-zoom">
      <button type="button" className="btn-icon" aria-label="PDF 上一页" disabled={!doc || page <= 1} onClick={() => setPage(value => value - 1)}><ToolbarIcon name="chevronLeft" /></button>
      <label>页 <input aria-label="PDF 页码" type="number" min={1} max={doc?.numPages ?? 1} value={page} onChange={event => { const value = Number(event.target.value); if (doc && Number.isInteger(value) && value >= 1 && value <= doc.numPages) setPage(value); }} /></label><span> / {doc?.numPages ?? "…"}</span>
      <button type="button" className="btn-icon" aria-label="PDF 下一页" disabled={!doc || page >= doc.numPages} onClick={() => setPage(value => value + 1)}><ToolbarIcon name="chevronRight" /></button>
      <select aria-label="PDF 缩放" value={zoom} onChange={event => setZoom(Number(event.target.value))}><option value={0}>适应宽度</option><option value={1}>100%</option><option value={.75}>75%</option><option value={1.25}>125%</option><option value={1.5}>150%</option><option value={2}>200%</option></select>
    </div>
    {busy && <span role="status">正在渲染 PDF…</span>}{error && <><p role="status">无法预览此 PDF：{error}</p>{fallback}</>}
    <div ref={viewport} className="file-browser-pdf-scroll" tabIndex={0} aria-label="PDF 内容"><div ref={surface} className="file-browser-pdf-page" /></div>
  </div>;
}
