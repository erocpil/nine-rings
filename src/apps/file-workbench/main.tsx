import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileBrowserWorkspace } from "../../components/FileBrowserWorkspace";
import { FileBrowserQuickPreview } from "../../components/FileBrowserQuickPreview";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import type { BrowserFileOpen } from "../../lib/local-files/browser-contract";
import { WorkspaceDialog } from "../../components/WorkspaceDialog";
import type { LocalFileDraft } from "../../lib/local-files/recovery";
import { downloadLocalSource } from "../../lib/local-files/source-download";
import { createWorkbenchHost } from "./host";
import "../../styles.css";
import "./workbench.css";

const SourceView = lazy(() => import("./SourceView").then(module => ({ default: module.WorkbenchSourceView })));
// A single host lifetime survives React renders; no builtin app bootstrap runs.
let showFile: (file: BrowserFileOpen) => void;
const host = createWorkbenchHost(file => showFile(file));
window.addEventListener("pagehide", event => { if (!event.persisted) host.dispose(); });
function Workbench() {
  const [file, setFile] = useState<BrowserFileOpen | null>(null);
  showFile = setFile;
  const closeSource = useRef<(() => void) | null>(null);
  const image = file && /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(file.node.name);
  const [draftToDelete, setDraftToDelete] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<LocalFileDraft[]>([]), [draftsOpen, setDraftsOpen] = useState(false), [draftError, setDraftError] = useState("");
  useEffect(() => {
    let live = true;
    const refresh = () => { void host.source.drafts.list().then(values => { if (live) setDrafts(values); }).catch(cause => { if (live) setDraftError(`恢复草稿不可用：${String(cause)}`); }); };
    refresh(); window.addEventListener("file-workbench:drafts", refresh);
    return () => { live = false; window.removeEventListener("file-workbench:drafts", refresh); };
  }, []);
  const [dark, setDark] = useState(() => { try { return host.workspace.settings.getItem("dark") === "true"; } catch { return false; } });
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("theme-dark", dark);
    document.documentElement.classList.toggle("theme-light", !dark);
  }, [dark]);
  return <main className="file-workbench-app" onKeyDown={event => {
    if (!file || event.key !== "Escape" || event.defaultPrevented || draftsOpen) return;
    if (event.target instanceof Element && event.target.closest(".cm-editor, dialog, [role='menu']")) return;
    event.preventDefault(); event.stopPropagation(); if (image) setFile(null); else closeSource.current?.();
  }}>
    <header className="file-workbench-brand"><strong>FILE WORKBENCH</strong><span>独立 Web 原型 · 文本编辑</span><button type="button" onClick={() => setDraftsOpen(true)}>恢复草稿（{drafts.length}）</button><button type="button" onClick={() => {
      const next = !dark;
      try { host.workspace.settings.setItem("dark", String(next)); } catch { /* Theme remains usable without storage. */ }
      setDark(next);
    }}>{dark ? "浅色" : "深色"}</button></header>
    <div className="file-workbench-content"><FileBrowserWorkspace workspace={host.workspace} active={!file} />
    {file && (image ? <FileBrowserQuickPreview rootId={file.rootId} node={file.node.id} provider={host.workspace.provider} active revision={0} onNavigate={() => false} onClose={() => setFile(null)} /> : <Suspense fallback={<p role="status">正在加载共享源码工作区…</p>}><SourceView key={`${file.rootId}:${file.node.id}`} file={file} host={host.source} onClose={() => setFile(null)} closeRequest={closeSource} /></Suspense>)}</div>
    <footer>授权目录可请求保存原文件；目录快照只能导出副本。目录操作暂未开放。授权仅限当前会话。{draftError && <span role="alert">{draftError}</span>}</footer>
    {draftsOpen && <WorkspaceDialog title="恢复草稿" onClose={() => { setDraftsOpen(false); setDraftToDelete(null); }}>{draftError && <p role="alert">{draftError}</p>}<p>草稿独立保存在本机。重新授权会生成新的目录身份，请下载草稿，再核对路径后手动恢复；不会自动覆盖重新授权的文件。最多保留 5 份草稿，不自动删除；满额时请先下载并处理旧草稿。</p>{!drafts.length && <p>没有未保存草稿。</p>}{drafts.map(draft => <article key={draft.identity}><strong>{draft.identity.slice(draft.identity.indexOf(":") + 1)}</strong><time>{new Date(draft.savedAt).toLocaleString()}</time><button type="button" onClick={() => { try { downloadLocalSource(draft.identity.split("/").pop()!.split(":").pop()!, draft.source, draft); } catch (cause) { setDraftError(String(cause)); } }}>下载草稿</button><button type="button" onClick={() => setDraftToDelete(draft.identity)}>删除草稿</button>{draftToDelete === draft.identity && <div><p>确认删除这份恢复草稿？请先核对或下载其内容。</p><button type="button" onClick={() => { void host.source.drafts.remove(draft.identity).then(() => setDraftToDelete(null)).catch(cause => setDraftError(String(cause))); }}>确认删除草稿</button><button type="button" onClick={() => setDraftToDelete(null)}>取消</button></div>}<pre>{draft.source.slice(0, 2000)}{draft.source.length > 2000 ? "…" : ""}</pre></article>)}</WorkspaceDialog>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<ErrorBoundary><Workbench /></ErrorBoundary>);
