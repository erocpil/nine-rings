import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileBrowserWorkspace } from "../../components/FileBrowserWorkspace";
import { FileBrowserQuickPreview } from "../../components/FileBrowserQuickPreview";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import type { BrowserFileOpen } from "../../lib/local-files/browser-contract";
import { createWorkbenchHost } from "./host";
import "../../styles.css";
import "./workbench.css";

// A single host lifetime survives React renders; no builtin app bootstrap runs.
let showFile: (file: BrowserFileOpen) => void;
const host = createWorkbenchHost(file => showFile(file));
window.addEventListener("pagehide", event => { if (!event.persisted) host.dispose(); });
function Workbench() {
  const [file, setFile] = useState<BrowserFileOpen | null>(null);
  showFile = setFile;
  const [dark, setDark] = useState(() => { try { return host.workspace.settings.getItem("dark") === "true"; } catch { return false; } });
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("theme-dark", dark);
    document.documentElement.classList.toggle("theme-light", !dark);
  }, [dark]);
  return <main className="file-workbench-app" onKeyDown={event => {
    if (file && event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); setFile(null); }
  }}>
    <header className="file-workbench-brand"><strong>FILE WORKBENCH</strong><span>独立 Web 原型 · 只读</span><button type="button" onClick={() => {
      const next = !dark;
      try { host.workspace.settings.setItem("dark", String(next)); } catch { /* Theme remains usable without storage. */ }
      setDark(next);
    }}>{dark ? "浅色" : "深色"}</button></header>
    <div className="file-workbench-content"><FileBrowserWorkspace workspace={host.workspace} active={!file} />
    {file && <FileBrowserQuickPreview rootId={file.rootId} node={file.node.id} provider={host.workspace.provider} active revision={0} onNavigate={() => false} onClose={() => setFile(null)} />}</div>
    <footer>请选择授权目录或目录快照。浏览、比较、搜索和预览共用 Nine Rings 实现；文件操作与编辑尚未开放。授权仅限当前会话。</footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<ErrorBoundary><Workbench /></ErrorBoundary>);
