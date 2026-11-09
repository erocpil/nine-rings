import { useEffect, useRef, useState } from "react";
import type { BrowserDirectoryProvider } from "../lib/local-files/browser-contract";
import { ToolbarIcon } from "./ToolbarIcon";
import { FileBrowserPreviewText } from "./FileBrowserPreviewText";
import { FileBrowserPreviewImage } from "./FileBrowserPreviewImage";
export function FileBrowserQuickPreview({ rootId, node, provider, active, revision, onClose, onNavigate }: { rootId: string; node?: string; provider: BrowserDirectoryProvider; active: boolean; revision: number; onClose: () => void; onNavigate: (direction: -1 | 1) => boolean }) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof provider.preview>> | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [findOpen, setFindOpen] = useState(false), [query, setQuery] = useState(""), [matchCase, setMatchCase] = useState(false), [navigationMessage, setNavigationMessage] = useState("");
  const host = useRef<HTMLElement>(null);
  useEffect(() => {
    setPreview(null); setError(""); setLoading(false); setNavigationMessage("");
    if (!active || !node) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void provider.preview(rootId, node, controller.signal).then(value => { if (!controller.signal.aborted) setPreview(value); }).catch(reason => { if (!controller.signal.aborted) setError(String(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [rootId, node, active, provider, revision]);
  const find = () => {
    setFindOpen(true);
    requestAnimationFrame(() => host.current?.querySelector<HTMLInputElement>('[aria-label="查找预览文本"]')?.focus());
  };
  const step = (direction: -1 | 1) => { if (!onNavigate(direction)) setNavigationMessage(`已加载范围中没有${direction === 1 ? "下一" : "上一"}文件；可在来源列表加载更多。`); };
  const closeFind = () => { setFindOpen(false); host.current?.focus({ preventScroll: true }); };
  return <section ref={host} tabIndex={0} className="file-browser-quick-preview" aria-label="快速预览" onKeyDown={event => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && preview?.kind === "text") { event.preventDefault(); event.stopPropagation(); find(); return; }
    if (event.key === "Escape" && findOpen && preview?.kind === "text") { event.preventDefault(); event.stopPropagation(); closeFind(); return; }
    if (!(event.target instanceof HTMLElement) || (event.target !== event.currentTarget && !event.target.closest("header")) || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); step(event.key === "ArrowUp" ? -1 : 1); }
  }}>
    <header><strong title={node}>预览 · {node?.split("/").pop() || "未选择文件"}</strong><button type="button" className="btn-icon" aria-label="预览上一文件" title="预览上一文件（↑，当前已加载范围）" onClick={() => step(-1)}><ToolbarIcon name="chevronLeft" /></button><button type="button" className="btn-icon" aria-label="预览下一文件" title="预览下一文件（↓，当前已加载范围）" onClick={() => step(1)}><ToolbarIcon name="chevronRight" /></button>{preview?.kind === "text" && <button type="button" className="btn-icon" aria-label="查找预览" title="查找预览（⌘/Ctrl+F）" aria-pressed={findOpen} onClick={() => findOpen ? closeFind() : find()}><ToolbarIcon name="search" /></button>}<button type="button" className="btn-icon" aria-label="关闭快速预览" onClick={onClose}><ToolbarIcon name="close" /></button></header>
    <p>磁盘已保存内容 · 只读{preview?.truncated ? " · 仅显示前 65536 字符" : ""}</p>
    {loading && <p role="status">正在读取预览…</p>}
    {error && <p role="status">无法预览此项：{error}。请选择文件或直接打开。</p>}
    {navigationMessage && <p role="status">{navigationMessage}</p>}
    {!node && <p>在另一栏选择一个文件。</p>}
    {preview?.kind === "image" ? <FileBrowserPreviewImage key={`${rootId}:${node}`} src={preview.value} name={node?.split("/").pop() ?? "预览"} /> : preview && <FileBrowserPreviewText source={preview.value} query={query} onQuery={setQuery} matchCase={matchCase} onCase={setMatchCase} findOpen={findOpen} onCloseFind={closeFind} />}
  </section>;
}
