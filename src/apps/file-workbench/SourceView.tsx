import { FileBrowserMarkdownMode } from "../../components/FileBrowserMarkdownMode";
import { FileBrowserFileDetails } from "../../components/FileBrowserFileDetails";
import type { BrowserDirectoryProvider } from "../../lib/local-files/browser-contract";
import type { WorkbenchCloseRequest } from "./native-lifecycle";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { EditorState } from "@codemirror/state";
import { DocumentSourceSurface } from "../../components/DocumentSourceSurface";
import { DocumentTitleBar } from "../../components/DocumentChrome";
import { DocumentActiveBoundary } from "../../components/RetainedDocument";
import { ToolbarIcon } from "../../components/ToolbarIcon";
import { TextDiffView } from "../../components/TextDiffView";
import { WorkspaceDialog } from "../../components/WorkspaceDialog";
import { documentLanguageFromFilename } from "../../lib/document-language";
import type { SourceEditorHandle } from "../../lib/source-editor-handle";
import type { BrowserFileOpen } from "../../lib/local-files/browser-contract";
import type { LocalFileSnapshot } from "../../lib/local-files/file-model";
import type { LocalSourceHost } from "../../lib/local-files/source-host";
import { saveLocalSource } from "../../lib/local-files/source-save";
import { exportLocalSource } from "../../lib/local-files/source-download";
import type { LocalFileDraft } from "../../lib/local-files/recovery";
import "../../styles/local-files.css";

const MarkdownPreview = lazy(() => import("../../components/FileBrowserPreviewMarkdown").then(module => ({ default: module.FileBrowserPreviewMarkdown })));

export function WorkbenchSourceView({ file, host, provider, onClose, closeRequest, onNavigate, previous = false, next = false }: {
  file: BrowserFileOpen; host: LocalSourceHost; provider: BrowserDirectoryProvider; onClose: () => void;
  closeRequest: MutableRefObject<WorkbenchCloseRequest | null>;
  onNavigate?: (direction: -1 | 1) => void; previous?: boolean; next?: boolean;
}) {
  const markdown = /\.(md|markdown)$/i.test(file.node.name);
  const [renderMarkdown, setRenderMarkdown] = useState(markdown && !file.location);
  const identity = `${file.rootId}:${file.node.id}`;
  const handle = useRef<SourceEditorHandle | null>(null), session = useRef<EditorState | null>(null);
  const [source, setSource] = useState(""), sourceRef = useRef("");
  const [base, setBase] = useState<LocalFileSnapshot | null>(null), baseRef = useRef<LocalFileSnapshot | null>(null);
  const [readonly, setReadonly] = useState(true), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false), busy = useRef(false);
  const [external, setExternal] = useState<LocalFileSnapshot | null>(null);
  const [leave, setLeave] = useState<"close" | "reload" | null>(null);
  const [draftAvailable, setDraftAvailable] = useState(true);
  const [candidate, setCandidate] = useState<LocalFileDraft | null>(null);
  const dirty = Boolean(base && source !== base.source);
  const current = useCallback(() => handle.current?.value ?? sourceRef.current, []);
  const change = (text: string) => { sourceRef.current = text; setSource(text); };
  const applyBase = (snapshot: LocalFileSnapshot) => { baseRef.current = snapshot; setBase(snapshot); };
  const checkpoint = useCallback(async () => {
    if (busy.current) throw new Error("文件正在保存，请等待完成。");
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = baseRef.current, text = current();
      if (!snapshot) return;
      if (text === snapshot.source) await host.drafts.remove(identity);
      else await host.drafts.write({ identity, source: text, baseSource: snapshot.source, baseRevision: snapshot.revision, bom: snapshot.bom, lineEnding: snapshot.lineEnding, savedAt: Date.now() });
      if (snapshot === baseRef.current && text === current()) return;
    }
    throw new Error("内容持续变化，尚不能安全离开；请暂停输入后重试。");
  }, [current, host, identity]);
  const read = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const snapshot = await host.read(file.rootId, file.node.id);
      let draft: LocalFileDraft | null = null;
      try { draft = await host.drafts.read(identity); setDraftAvailable(true); }
      catch (cause) { setDraftAvailable(false); setNotice(`恢复草稿不可用，暂时只读：${String(cause)}`); }
      setCandidate(draft?.source !== snapshot.source ? draft : null);
      sourceRef.current = snapshot.source; setSource(snapshot.source); baseRef.current = snapshot; setBase(snapshot);
      session.current = null; setExternal(null); setReadonly(true);
    } catch (cause) { setError(String(cause)); }
    finally { setLoading(false); }
  }, [file.rootId, file.node.id, host, identity]);
  useEffect(() => {
    let live = true;
    void host.read(file.rootId, file.node.id).then(async snapshot => {
      const recovery = await host.drafts.read(identity).then(draft => ({ draft, issue: "" })).catch(cause => ({ draft: null, issue: String(cause) }));
      if (!live) return;
      const draft = recovery.draft;
      setDraftAvailable(!recovery.issue);
      if (recovery.issue) setNotice(`恢复草稿不可用，暂时只读：${recovery.issue}`);
      sourceRef.current = snapshot.source; setSource(snapshot.source); baseRef.current = snapshot; setBase(snapshot); setCandidate(draft?.source !== snapshot.source ? draft : null); setLoading(false);
    }).catch(cause => { if (live) { setError(String(cause)); setLoading(false); } });
    return () => { live = false; };
  }, [host, identity, file.rootId, file.node.id]);
  useEffect(() => {
    if (!dirty || candidate || saving) return;
    const timer = window.setTimeout(() => { void checkpoint().then(() => setNotice("未保存编辑已暂存到本机草稿。"), cause => setNotice(`草稿暂存失败：${String(cause)}`)); }, 500);
    return () => clearTimeout(timer);
  }, [dirty, source, candidate, saving, checkpoint]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (busy.current || (baseRef.current && current() !== baseRef.current.source)) {
        event.preventDefault(); event.returnValue = "";
        if (!busy.current) void checkpoint().catch(() => {});
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [current, checkpoint]);
  const pendingClose = useRef<(() => void) | null>(null);
  const finishClose = useCallback(() => {
    const finish = pendingClose.current; pendingClose.current = null; finish?.();
  }, []);
  const cancelLeave = () => { pendingClose.current = null; setLeave(null); };
  const requestClose = useCallback((afterLeave?: () => void) => {
    if (busy.current) { setNotice("文件正在保存，请等待完成后再返回。"); return; }
    pendingClose.current = afterLeave ?? onClose;
    if (baseRef.current && current() !== baseRef.current.source) setLeave("close");
    else if (candidate || !draftAvailable) finishClose();
    else void checkpoint().then(() => {
      if (baseRef.current && current() !== baseRef.current.source) setLeave("close");
      else finishClose();
    }).catch(cause => setError(String(cause)));
  }, [candidate, checkpoint, current, draftAvailable, finishClose, onClose]);
  useEffect(() => { closeRequest.current = requestClose; return () => { closeRequest.current = null; }; }, [closeRequest, requestClose]);
  const save = useCallback(async () => {
    if (busy.current || !baseRef.current) return false;
    if (candidate) { setNotice("请先处理已有恢复草稿，未执行保存。"); return false; }
    if (current() === baseRef.current.source) return true;
    if (!host.canSaveOriginal(file.rootId)) { setNotice("目录快照不能保存原文件，请导出副本。"); return false; }
    busy.current = true; setSaving(true); setError("");
    try {
      const result = await saveLocalSource({ submitted: current(), base: baseRef.current, currentSource: current,
        write: (text, snapshot) => host.write(file.rootId, file.node.id, text, snapshot),
        committed: saved => { baseRef.current = saved; setBase(saved); setExternal(null); },
        clearDraft: () => host.drafts.remove(identity),
        keepDraft: (text, saved) => host.drafts.write({ identity, source: text, baseSource: saved.source, baseRevision: saved.revision, bom: saved.bom, lineEnding: saved.lineEnding, savedAt: Date.now() }),
      });
      setNotice(result.recoveryIssue || (result.clean ? "文件已保存到磁盘。" : "提交时的内容已保存；之后的编辑尚未保存。"));
      return result.clean && !result.recoveryIssue;
    } catch (cause) {
      if (String(cause).includes("STALE_REVISION")) {
        setExternal(await host.read(file.rootId, file.node.id).catch(() => null));
        setError("磁盘文件已变化，未覆盖。请比较后导出副本或重新读取磁盘文件。");
      } else setError(String(cause));
      return false;
    } finally { busy.current = false; setSaving(false); }
  }, [current, host, file.rootId, file.node.id, identity, candidate]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (document.querySelector("dialog[open]")) return; if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [save]);
  const copy = async () => { try { if (await exportLocalSource(file.node.name, current(), baseRef.current, host.saveCopy)) setNotice("已导出当前内容副本；原文件未改变，未保存状态保留。"); } catch (cause) { setError(String(cause)); } };
  const keepAndLeave = async () => {
    try { await checkpoint(); const target = leave; setLeave(null); if (target === "close") finishClose(); else await read(); }
    catch (cause) { setError(String(cause)); }
  };
  const searchLocation = useRef(file.location), appliedSearch = useRef(false);
  // Source surface owns the live editor/session. A changing callback would
  // recreate it on every keystroke and restore obsolete compartments/history.
  const bindHandle = useCallback((editor: SourceEditorHandle | null) => {
    const location = searchLocation.current, snapshot = baseRef.current;
    if (!editor || appliedSearch.current || !location || !snapshot) return;
    appliedSearch.current = true;
    if (snapshot.revision !== location.revision || current() !== snapshot.source) return;
    editor.setSelectionRange(Math.min(location.from, editor.value.length), Math.min(location.to, editor.value.length));
    editor.scrollToOffset(Math.min(location.from, editor.value.length), true);
  }, [current]);
  return <section className="local-file-view workbench-source-view" aria-label="文件源码工作区" onKeyDownCapture={event => {
    if (!readonly || !onNavigate || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !["ArrowLeft", "ArrowRight"].includes(event.key) || (event.target as Element).closest("input, textarea, select, dialog, [role=dialog]")) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === "ArrowLeft" ? previous : next) requestClose(() => onNavigate(event.key === "ArrowLeft" ? -1 : 1));
  }}>
    <DocumentTitleBar className="local-files-toolbar local-file-titlebar"><strong title={file.node.id}>{file.node.name}</strong><span>{saving ? "正在保存…" : dirty ? "未保存" : "磁盘文本"}</span>
      {onNavigate && <><button className="btn-icon" type="button" aria-label="上一文件" title="上一文件（←，只读预览）" disabled={!previous} onClick={() => requestClose(() => onNavigate(-1))}><ToolbarIcon name="chevronLeft" /></button><button className="btn-icon" type="button" aria-label="下一文件" title="下一文件（→，只读预览）" disabled={!next} onClick={() => requestClose(() => onNavigate(1))}><ToolbarIcon name="chevronRight" /></button></>}
      <button className="btn-icon" type="button" aria-label={readonly ? "允许编辑" : "设为只读"} title={readonly ? "允许编辑" : "设为只读"} disabled={loading || !base || Boolean(candidate) || !draftAvailable} onClick={() => { setReadonly(value => !value); setRenderMarkdown(false); }}><ToolbarIcon name={readonly ? "lock" : "edit"} /></button>
      <button className="btn-icon" type="button" aria-label="保存文件" title="保存文件（⌘/Ctrl+S）" disabled={loading || !dirty || saving || !host.canSaveOriginal(file.rootId)} onClick={() => void save()}><ToolbarIcon name="save" /></button>
      <button className="btn-icon" type="button" aria-label="导出副本" title="导出副本" disabled={loading || !base} onClick={() => void copy()}><ToolbarIcon name="download" /></button>
      <button className="btn-icon" type="button" aria-label="重新读取原文件" title="重新读取原文件" disabled={loading || saving} onClick={() => { if (dirty) setLeave("reload"); else void read(); }}><ToolbarIcon name="refresh" /></button>
      {markdown && <FileBrowserMarkdownMode rendered={renderMarkdown} disabled={!base} onChange={setRenderMarkdown} />}
      <button className="btn-icon" type="button" aria-label="返回文件浏览" title="关闭预览，返回文件浏览" onClick={() => requestClose()}><ToolbarIcon name="close" /></button>
    </DocumentTitleBar>
    {loading && <p role="status">正在读取文件…</p>}
    {error && !base ? <><p role="status">此文件暂时无法内置预览，可使用其它应用打开。</p><FileBrowserFileDetails rootId={file.rootId} node={file.node.id} provider={provider} /></> : error && <p role="alert">{error}<button type="button" aria-label="关闭文件错误" onClick={() => setError("")}>×</button></p>}
    {notice && <p className="workbench-source-notice" role="status">{notice}<button type="button" aria-label="关闭文件提示" onClick={() => setNotice("")}>×</button></p>}
    {candidate && <div role="status">发现此会话未保存草稿。<button type="button" onClick={() => { change(candidate.source); applyBase({ ...base!, source: candidate.baseSource, revision: candidate.baseRevision, bom: candidate.bom, lineEnding: candidate.lineEnding }); setCandidate(null); setReadonly(false); setRenderMarkdown(false); }}>恢复草稿</button><button type="button" onClick={() => { void exportLocalSource(file.node.name, candidate.source, candidate, host.saveCopy).catch(cause => setError(String(cause))); }}>下载草稿</button><button type="button" onClick={() => { void host.drafts.remove(identity).then(() => setCandidate(null)).catch(cause => setError(String(cause))); }}>删除草稿</button></div>}
    {!loading && base && renderMarkdown ? <Suspense fallback={<p role="status">正在加载 Markdown 预览…</p>}><MarkdownPreview source={source} autoFocus /></Suspense> : !loading && base && <div className="local-file-editor-shell"><DocumentActiveBoundary active><DocumentSourceSurface editor={{ value: source, readonly, areaRef: handle, session, onChange: change, fontSize: 16, highlightActiveLine: true, showLineNumbers: true, showStatusBar: true, contextMenuEnabled: true, documentLanguage: documentLanguageFromFilename(file.node.name, source), saveStatus: saving ? "saving" : dirty ? "dirty" : "clean", savedLabel: "保存到原文件；不参与数据库备份", navigation: null,
      onReady: bindHandle,
    }} /></DocumentActiveBoundary></div>}
    {external && <WorkspaceDialog title="磁盘版本比较" onClose={() => setExternal(null)}><TextDiffView left={source} right={external.source} leftLabel="当前编辑" rightLabel="磁盘版本" /></WorkspaceDialog>}
    {leave && <WorkspaceDialog title="未保存的文件编辑" onClose={cancelLeave}>{error && <p role="alert">{error}</p>}<p>请先保存到原文件，或确认恢复草稿已持久化后离开。导出副本不会将原文件标记为已保存。最多保留 5 份草稿，不自动淘汰；满额时须先处理旧草稿。</p><div>
      <button type="button" disabled={saving || !host.canSaveOriginal(file.rootId)} onClick={() => { void save().then(clean => { if (clean) { const target = leave; setLeave(null); if (target === "close") finishClose(); else void read(); } }); }}>保存后继续</button>
      <button type="button" disabled={saving} onClick={() => void keepAndLeave()}>保留草稿后继续</button><button type="button" onClick={cancelLeave}>取消</button>
    </div></WorkspaceDialog>}
  </section>;
}
