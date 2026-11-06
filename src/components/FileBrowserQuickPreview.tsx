import { useEffect, useState } from "react";
import type { localDirectoryProvider } from "../lib/local-files/browser-provider";
import { ToolbarIcon } from "./ToolbarIcon";
export function FileBrowserQuickPreview({ rootId, node, provider, active, revision, onClose }: { rootId: string; node?: string; provider: ReturnType<typeof localDirectoryProvider>; active: boolean; revision: number; onClose: () => void }) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof provider.preview>> | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  useEffect(() => {
    setPreview(null); setError(""); setLoading(false);
    if (!active || !node) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void provider.preview(rootId, node, controller.signal).then(value => { if (!controller.signal.aborted) setPreview(value); }).catch(reason => { if (!controller.signal.aborted) setError(String(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [rootId, node, active, provider, revision]);
  return <section className="file-browser-quick-preview" aria-label="快速预览">
    <header><strong title={node}>预览 · {node?.split("/").pop() || "未选择文件"}</strong><button type="button" className="btn-icon" aria-label="关闭快速预览" onClick={onClose}><ToolbarIcon name="close" /></button></header>
    <p>磁盘已保存内容 · 只读{preview?.truncated ? " · 仅显示前 65536 字符" : ""}</p>
    {loading && <p role="status">正在读取预览…</p>}
    {error && <p role="status">无法预览此项：{error}。请选择文件或直接打开。</p>}
    {!node && <p>在另一栏选择一个文件。</p>}
    {preview?.kind === "image" ? <div className="file-browser-preview-image"><img src={preview.value} alt={node?.split("/").pop() ?? "预览"} /></div> : preview && <pre tabIndex={0}>{preview.value}</pre>}
  </section>;
}
