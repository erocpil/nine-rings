import { releaseBrowserPreview } from "../lib/local-files/browser-preview";
import { FileBrowserFileDetails } from "./FileBrowserFileDetails";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BrowserDirectoryProvider } from "../lib/local-files/browser-contract";
import { ToolbarIcon } from "./ToolbarIcon";
import { FileBrowserMarkdownMode } from "./FileBrowserMarkdownMode";
import { FileBrowserPreviewText } from "./FileBrowserPreviewText";
import { FileBrowserPreviewImage } from "./FileBrowserPreviewImage";
const PdfPreview = lazy(() => import("./FileBrowserPreviewPdf").then(module => ({ default: module.FileBrowserPreviewPdf })));
const MarkdownPreview = lazy(() => import("./FileBrowserPreviewMarkdown").then(module => ({ default: module.FileBrowserPreviewMarkdown })));
export function FileBrowserQuickPreview({ rootId, node, provider, active, revision, onClose, onNavigate, closeLabel = "关闭快速预览", autoFocus = false, navigationAxis = "vertical", previous = true, next = true }: { rootId: string; node?: string; provider: BrowserDirectoryProvider; active: boolean; revision: number; onClose: () => void; closeLabel?: string; autoFocus?: boolean; navigationAxis?: "vertical" | "horizontal"; previous?: boolean; next?: boolean; onNavigate?: (direction: -1 | 1) => boolean }) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof provider.preview>> | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [renderMarkdown, setRenderMarkdown] = useState(true);
  const markdown = /\.(md|markdown)$/i.test(node ?? "");
  const [wrap, setWrap] = useState(true);
  const [findOpen, setFindOpen] = useState(false), [query, setQuery] = useState(""), [matchCase, setMatchCase] = useState(false), [navigationMessage, setNavigationMessage] = useState("");
  const positions = useRef({ source: { top: 0, left: 0 }, rendered: { top: 0, left: 0 } });
  useEffect(() => { positions.current = { source: { top: 0, left: 0 }, rendered: { top: 0, left: 0 } }; }, [rootId, node]);
  const host = useRef<HTMLElement>(null);
  const request = useRef<AbortController | null>(null);
  const [cancelled, setCancelled] = useState(false);
  useLayoutEffect(() => { if (active && autoFocus) host.current?.focus({ preventScroll: true }); }, [active, autoFocus]);
  useEffect(() => {
    setPreview(null); setError(""); setLoading(false); setNavigationMessage(""); setCancelled(false);
    if (!active || !node) return;
    const controller = new AbortController(); request.current = controller;
    let owned: Awaited<ReturnType<typeof provider.preview>> | null = null;
    controller.signal.addEventListener("abort", () => { releaseBrowserPreview(owned); owned = null; }, { once: true });
    const timer = window.setTimeout(() => {
      setLoading(true);
      void provider.preview(rootId, node, controller.signal).then(value => { if (controller.signal.aborted) releaseBrowserPreview(value); else { owned = value; setPreview(value); } }).catch(reason => { if (!controller.signal.aborted) setError(String(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [rootId, node, active, provider, revision]);
  const find = () => {
    setRenderMarkdown(false); setFindOpen(true);
    requestAnimationFrame(() => host.current?.querySelector<HTMLInputElement>('[aria-label="查找预览文本"]')?.focus());
  };
  const step = (direction: -1 | 1) => { if (onNavigate && !onNavigate(direction)) setNavigationMessage(`已加载范围中没有${direction === 1 ? "下一" : "上一"}文件；可在来源列表加载更多。`); };
  const closeFind = () => { setFindOpen(false); host.current?.focus({ preventScroll: true }); };
  return <section ref={host} tabIndex={0} className="file-browser-quick-preview" aria-label="快速预览" onKeyDown={event => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && preview?.kind === "text") { event.preventDefault(); event.stopPropagation(); find(); return; }
    if (event.key === "Escape" && findOpen && preview?.kind === "text") { event.preventDefault(); event.stopPropagation(); closeFind(); return; }
    if (!(event.target instanceof HTMLElement) || (event.target !== event.currentTarget && !event.target.closest("header")) || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const keys = navigationAxis === "horizontal" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (onNavigate && keys.includes(event.key)) { event.preventDefault(); event.stopPropagation(); step(event.key === keys[0] ? -1 : 1); }
  }}>
    <header><strong title={node}>预览 · {node?.split("/").pop() || "未选择文件"}</strong>{onNavigate && <><button type="button" className="btn-icon" aria-label={navigationAxis === "horizontal" ? "上一文件" : "预览上一文件"} disabled={!previous} title={`上一文件（${navigationAxis === "horizontal" ? "←" : "↑"}，当前已加载范围）`} onClick={() => step(-1)}><ToolbarIcon name="chevronLeft" /></button><button type="button" className="btn-icon" aria-label={navigationAxis === "horizontal" ? "下一文件" : "预览下一文件"} disabled={!next} title={`下一文件（${navigationAxis === "horizontal" ? "→" : "↓"}，当前已加载范围）`} onClick={() => step(1)}><ToolbarIcon name="chevronRight" /></button></>}{preview?.kind === "text" && markdown && <FileBrowserMarkdownMode rendered={renderMarkdown && !findOpen} onChange={value => { setRenderMarkdown(value); closeFind(); }} />}{preview?.kind === "text" && <button type="button" className="btn-icon" aria-label="预览自动换行" title="自动换行" aria-pressed={wrap} onClick={() => setWrap(value => !value)}><ToolbarIcon name="wrap" /></button>}{preview?.kind === "text" && <button type="button" className="btn-icon" aria-label="查找预览" title="查找预览（⌘/Ctrl+F）" aria-pressed={findOpen} onClick={() => findOpen ? closeFind() : find()}><ToolbarIcon name="search" /></button>}<button type="button" className="btn-icon" aria-label={closeLabel} title="关闭预览，返回文件浏览" onClick={onClose}><ToolbarIcon name="close" /></button></header>
    <p>磁盘已保存内容 · 只读{preview?.truncated ? " · 仅显示前 65536 字符" : ""}</p>
    {loading && <p role="status">正在加载预览，大文件可能需要较长时间… <button type="button" onClick={() => { request.current?.abort(); setLoading(false); setPreview(null); setCancelled(true); }}>中断加载</button></p>}
    {(error || cancelled) && <><p role="status">{cancelled ? "已中断预览加载。" : "此文件暂时无法内置预览，可使用其它应用打开。"}</p>{node && <FileBrowserFileDetails rootId={rootId} node={node} provider={provider} />}</>}
    {navigationMessage && <p role="status">{navigationMessage}</p>}
    {!node && <p>在另一栏选择一个文件。</p>}
    {preview?.kind === "pdf" ? <Suspense fallback={<p role="status">正在加载 PDF 预览…</p>}><PdfPreview key={`${rootId}:${node}`} blob={preview.value} fallback={<FileBrowserFileDetails rootId={rootId} node={node!} provider={provider} />} /></Suspense> : preview?.kind === "text" && markdown && renderMarkdown && !findOpen ? <Suspense fallback={<p role="status">正在加载 Markdown 预览…</p>}><MarkdownPreview source={preview.value} position={positions.current.rendered} /></Suspense> : preview?.kind === "image" ? <FileBrowserPreviewImage key={`${rootId}:${node}`} src={preview.value} name={node?.split("/").pop() ?? "预览"} onCancel={() => { request.current?.abort(); setPreview(null); setCancelled(true); }} onUnavailable={() => { request.current?.abort(); setPreview(null); setError("unsupported"); }} /> : preview && <FileBrowserPreviewText position={positions.current.source} wrap={wrap} source={preview.value} query={query} onQuery={setQuery} matchCase={matchCase} onCase={setMatchCase} findOpen={findOpen} onCloseFind={closeFind} />}
  </section>;
}
