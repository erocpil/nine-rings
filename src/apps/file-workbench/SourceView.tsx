import { BufferSaveCancelled } from "./buffer-documents";
import { MoreToolsButton } from "../../components/MoreToolsButton";
import { useFocusEditorTools } from "../../stores/useFocusEditorTools";
import { isPrimaryShortcutModifier } from "../../lib/shortcuts";
import { isTauriRuntime } from "../../lib/runtime";
import { TypographySettings } from "./TypographySettings";
import { useWorkbenchTypography, workbenchTypographyVariables } from "./typography";
import { blockFontFamily } from "../../lib/editor-appearance";
import { useLocalFileDetails } from "../../hooks/useLocalFileDetails";
import { localFileInfoTimes } from "../../lib/local-files/file-info-times";
import { DocumentTitleField } from "../../components/DocumentTitleField";
import { PanelSideToggle } from "../../components/PanelSideToggle";
import { createPortal } from "react-dom";
import { DocumentNavigationWorkspace } from "../../components/DocumentNavigationWorkspace";
import { sourceAnchorMapping, SourceNavigationDocument } from "../../lib/markdown-source-navigation";
import { useMarkdownViewPosition } from "../../hooks/useMarkdownViewPosition";
import { deltaToProseMirror } from "../../lib/delta-converter";
import { writeDocumentSource } from "../../lib/document-source";
import { DocumentImageLibraryContext } from "../../components/DocumentResourceContext";
import type { Editor } from "@tiptap/core";
import type { LocalRenderedFlush } from "../../components/LocalMarkdownWorkspace";
import { EditorFoldIconContext } from "../../components/EditorFoldIconContext";
import { readWorkbenchEditorSettings, saveWorkbenchEditorSettings, readWorkbenchFileLanguage, saveWorkbenchFileLanguage, EDITOR_SETTINGS_EVENT } from "./editor-settings";
import type { BrowserSettingsStore } from "../../lib/local-files/browser-workspace-contract";
import { FileBrowserMarkdownMode } from "../../components/FileBrowserMarkdownMode";
import { FileBrowserFileDetails } from "../../components/FileBrowserFileDetails";
import type { BrowserDirectoryProvider } from "../../lib/local-files/browser-contract";
import type { WorkbenchCloseRequest } from "./native-lifecycle";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, useMemo, type MutableRefObject, type ReactNode } from "react";
import type { EditorState } from "@codemirror/state";
import { DocumentSourceSurface } from "../../components/DocumentSourceSurface";
import { DocumentTitleBar, DocumentAccessToggle } from "../../components/DocumentChrome";
import { DocumentActiveBoundary } from "../../components/RetainedDocument";
import { ToolbarIcon } from "../../components/ToolbarIcon";
import { TextDiffView } from "../../components/TextDiffView";
import { WorkspaceDialog } from "../../components/WorkspaceDialog";
import { AUTO_DOCUMENT_LANGUAGE, DOCUMENT_LANGUAGE_OPTIONS, documentLanguageViewOptions, documentLanguageFromFilename } from "../../lib/document-language";
import type { SourceEditorHandle } from "../../lib/source-editor-handle";
import type { BrowserFileOpen } from "../../lib/local-files/browser-contract";
import type { LocalFileSnapshot } from "../../lib/local-files/file-model";
import type { LocalSourceHost } from "../../lib/local-files/source-host";
import { saveLocalSource } from "../../lib/local-files/source-save";
import { exportLocalSource } from "../../lib/local-files/source-download";
import type { LocalFileDraft } from "../../lib/local-files/recovery";
import "../../styles/local-files.css";

const MarkdownWorkspace = lazy(() => import("../../components/LocalMarkdownWorkspace").then(module => ({ default: module.LocalMarkdownWorkspace })));
const resolveResource = async (src: string) => /^(https?:|data:image\/|blob:)/i.test(src) ? null : "";

export function WorkbenchSourceView({ file, host, provider, settings, onClose, closeRequest, onNavigate, headerActions, previous = false, next = false, active = true, closeLabel = "返回文件浏览", onCloseCancelled, onDirtyChange, navigationRequest, beforeCloseActions, onCreateDocument, untitled = false, initialReadonly = true, documentPath, persistDocument = false }: {
  beforeCloseActions?: ReactNode;
  onCreateDocument?: () => void;
  untitled?: boolean; initialReadonly?: boolean; documentPath?: string; persistDocument?: boolean;
  navigationRequest?: number;
  active?: boolean; closeLabel?: string; onCloseCancelled?: () => void; onDirtyChange?: (dirty: boolean) => void;
  settings: BrowserSettingsStore;
  headerActions?: ReactNode;
  file: BrowserFileOpen; host: LocalSourceHost; provider: BrowserDirectoryProvider; onClose: () => void;
  closeRequest: MutableRefObject<WorkbenchCloseRequest | null>;
  onNavigate?: (direction: -1 | 1) => void; previous?: boolean; next?: boolean;
}) {
  const typography = useWorkbenchTypography(settings);
  const [typographyOpen, setTypographyOpen] = useState(false);
  const [editorSettings, setEditorSettings] = useState(() => readWorkbenchEditorSettings(settings));
  useEffect(() => {
    const sync = () => setEditorSettings(readWorkbenchEditorSettings(settings));
    window.addEventListener(EDITOR_SETTINGS_EVENT, sync);
    window.addEventListener("storage", sync);
    sync();
    return () => { window.removeEventListener(EDITOR_SETTINGS_EVENT, sync); window.removeEventListener("storage", sync); };
  }, [settings]);
  const identity = `${file.rootId}:${file.node.id}`;
  const [source, setSource] = useState(""), sourceRef = useRef("");
  const [languageOverride, setLanguageOverride] = useState(() => readWorkbenchFileLanguage(settings, identity));
  const detectedLanguage = documentLanguageFromFilename(file.node.name, source);
  const language = languageOverride ?? detectedLanguage;
  const markdown = language === "markdown";
  const [renderMarkdown, setRenderMarkdown] = useState(markdown && !file.location);
  const [renderMounted, setRenderMounted] = useState(markdown && !file.location);
  const [sourceMounted, setSourceMounted] = useState(!markdown || Boolean(file.location));
  const previewRoot = useRef<HTMLElement>(null);
  const position = useMarkdownViewPosition(`workbench:${identity}`, !renderMarkdown, false, previewRoot);
  const { area: handle, onSourceReady } = position;
  const positionRef = useRef(position); positionRef.current = position;
  const session = useRef<EditorState | null>(null);
  const renderedEditor = useRef<Editor | null>(null);
  const readonlyCurrent = useRef(true);
  const activeCurrent = useRef(active); activeCurrent.current = active;
  const renderedFlush = useRef<LocalRenderedFlush | null>(null);
  const [renderPending, setRenderPending] = useState(false);
  const [renderEpoch, setRenderEpoch] = useState(0);
  const renderMode = useRef(renderMarkdown); renderMode.current = renderMarkdown;
  const registerRenderedFlush = useCallback((value: LocalRenderedFlush | null) => { renderedFlush.current = value; }, []);
  const bindRendered = useCallback((editor: Editor | null) => {
    renderedEditor.current = editor; positionRef.current.onRenderedReady(editor);
    if (editor && activeCurrent.current && renderMode.current && !document.querySelector("dialog[open]")) {
      if (readonlyCurrent.current) previewRoot.current?.focus({ preventScroll: true });
      else requestAnimationFrame(() => { if (activeCurrent.current && renderMode.current && renderedEditor.current === editor && !editor.isDestroyed && !document.querySelector("dialog[open]")) editor.view.focus(); });
    }
  }, []);
  const changePreviewMode = (value: boolean) => {
    if (value === renderMode.current) return;
    try {
      renderedFlush.current?.flush();
      const text = sourceRef.current;
      const doc = deltaToProseMirror(writeDocumentSource(text, "markdown"));
      if (value) position.toRendered(text, doc);
      else {
        if (handle.current && handle.current.value !== text) handle.current.insertIsolated(0, handle.current.view.state.doc.length, text);
        position.toSource(text, doc, undefined, renderedEditor.current?.state.selection.from);
      }
      if (value) setRenderMounted(true); else setSourceMounted(true);
      renderMode.current = value;
      setRenderMarkdown(value);
    } catch (cause) { setError(String(cause)); }
  };
  const [lineBookmarks, setLineBookmarks] = useState<{ id: string; position: number; label: string; preview: string }[]>(() => {
    try { const value: unknown = JSON.parse(settings.getItem(`bookmarks:${identity}`) ?? "[]"); return Array.isArray(value) ? value.filter(item => item && typeof item.id === "string" && Number.isSafeInteger(item.position) && item.position >= 0 && typeof item.label === "string" && typeof item.preview === "string") : []; } catch { return []; }
  });
  const sourceNavigation = useMemo(() => new SourceNavigationDocument(source, [], { sourceLanguage: language }), [source, language]);
  const sourceProjection = useRef("");
  if (!renderMarkdown || !sourceMounted) sourceProjection.current = source;
  const [base, setBase] = useState<LocalFileSnapshot | null>(null), baseRef = useRef<LocalFileSnapshot | null>(null);
  const [readonly, setReadonly] = useState(initialReadonly), [loading, setLoading] = useState(true);
  readonlyCurrent.current = readonly;
  const previousReadonly = useRef(readonly);
  useEffect(() => {
    const unlocked = previousReadonly.current && !readonly;
    previousReadonly.current = readonly;
    if (!unlocked || !active) return;
    const frame = requestAnimationFrame(() => {
      if (readonlyCurrent.current || !activeCurrent.current || document.querySelector("dialog[open], [role=dialog]")) return;
      if (renderMode.current) {
        const editor = renderedEditor.current;
        if (editor && !editor.isDestroyed && editor.isEditable) editor.view.focus();
      } else handle.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [readonly, active, handle]);

  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false), busy = useRef(false);
  const [external, setExternal] = useState<LocalFileSnapshot | null>(null);
  const [leave, setLeave] = useState<"close" | "reload" | null>(null);
  const [draftAvailable, setDraftAvailable] = useState(true);
  const [candidate, setCandidate] = useState<LocalFileDraft | null>(null);
  const dirty = Boolean(base && (untitled || source !== base.source || renderPending));
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const current = useCallback(() => { renderedFlush.current?.flush(); return sourceRef.current; }, []);
  const change = (text: string) => {
    const before = sourceRef.current;
    setLineBookmarks(items => {
      if (!items.length) return items;
      const map = sourceAnchorMapping(before, text);
      return items.map(item => ({ ...item, position: Math.max(0, Math.min(text.length, map(item.position))) }));
    });
    sourceRef.current = text; setSource(text);
  };
  useEffect(() => {
    try { settings.setItem(`bookmarks:${identity}`, JSON.stringify(lineBookmarks)); }
    catch { setNotice("书签未能保存到本机，请检查存储空间。 "); }
  }, [identity, lineBookmarks, settings]);
  const renderedChange = (text: string) => { change(text); setRenderPending(false); };
  const applyBase = (snapshot: LocalFileSnapshot) => { baseRef.current = snapshot; setBase(snapshot); };
  const checkpoint = useCallback(async () => {
    if (busy.current) throw new Error("文件正在保存，请等待完成。");
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = baseRef.current, text = current();
      if (!snapshot) return;
      if (text === snapshot.source && !persistDocument) await host.drafts.remove(identity);
      else await host.drafts.write({ identity, source: text, baseSource: snapshot.source, baseRevision: snapshot.revision, bom: snapshot.bom, lineEnding: snapshot.lineEnding, savedAt: Date.now() });
      if (snapshot === baseRef.current && text === current()) return;
    }
    throw new Error("内容持续变化，尚不能安全离开；请暂停输入后重试。");
  }, [current, host, identity, persistDocument]);
  const read = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const snapshot = await host.read(file.rootId, file.node.id);
      let draft: LocalFileDraft | null = null;
      try { draft = await host.drafts.read(identity); setDraftAvailable(true); }
      catch (cause) { setDraftAvailable(false); setNotice(`恢复草稿不可用，暂时只读：${String(cause)}`); }
      setCandidate(draft?.source !== snapshot.source ? draft : null);
      sourceRef.current = snapshot.source; sourceProjection.current = snapshot.source; setSource(snapshot.source); baseRef.current = snapshot; setBase(snapshot);
      session.current = null; setRenderEpoch(value => value + 1); setRenderPending(false); setExternal(null); setReadonly(initialReadonly);
    } catch (cause) { setError(String(cause)); }
    finally { setLoading(false); }
  }, [file.rootId, file.node.id, host, identity, initialReadonly]);
  useEffect(() => {
    let live = true;
    void host.read(file.rootId, file.node.id).then(async snapshot => {
      const recovery = await host.drafts.read(identity).then(draft => ({ draft, issue: "" })).catch(cause => ({ draft: null, issue: String(cause) }));
      if (!live) return;
      const draft = recovery.draft;
      setDraftAvailable(!recovery.issue);
      if (recovery.issue) setNotice(`恢复草稿不可用，暂时只读：${recovery.issue}`);
      sourceRef.current = snapshot.source; sourceProjection.current = snapshot.source; setSource(snapshot.source); baseRef.current = snapshot; setBase(snapshot); setCandidate(draft?.source !== snapshot.source ? draft : null); setLoading(false);
    }).catch(cause => { if (live) { setError(String(cause)); setLoading(false); } });
    return () => { live = false; };
  }, [host, identity, file.rootId, file.node.id]);
  useEffect(() => {
    if (!dirty || candidate || saving || leave || error) return;
    const timer = window.setTimeout(() => { void checkpoint().catch(cause => setError(`草稿暂存失败：${String(cause)}`)); }, untitled ? 150 : 500);
    return () => clearTimeout(timer);
  }, [dirty, source, candidate, saving, checkpoint, untitled, leave, error]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (busy.current || renderedFlush.current?.pending() || (baseRef.current && sourceRef.current !== baseRef.current.source)) {
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
  const cancelLeave = () => { pendingClose.current = null; setLeave(null); setError(""); setNotice(""); onCloseCancelled?.(); };
  const requestClose = useCallback((afterLeave?: () => void) => {
    if (busy.current || loading) { setNotice("文件正在加载或保存，请等待完成后再关闭。"); onCloseCancelled?.(); return; }
    let text: string;
    try { text = current(); } catch (cause) { setError(String(cause)); onCloseCancelled?.(); return; }
    pendingClose.current = afterLeave ?? onClose;
    if (baseRef.current && (untitled || text !== baseRef.current.source)) setLeave("close");
    else if (candidate || !draftAvailable) finishClose();
    else void checkpoint().then(() => {
      if (baseRef.current && current() !== baseRef.current.source) setLeave("close");
      else finishClose();
    }).catch(cause => { setError(String(cause)); onCloseCancelled?.(); });
  }, [candidate, checkpoint, current, draftAvailable, finishClose, onClose, loading, onCloseCancelled, untitled]);
  useEffect(() => { closeRequest.current = requestClose; return () => { closeRequest.current = null; }; }, [closeRequest, requestClose]);
  const save = useCallback(async () => {
    if (busy.current || !baseRef.current) return false;
    if (candidate) { setNotice("请先处理已有恢复草稿，未执行保存。"); return false; }
    try { if (!untitled && current() === baseRef.current.source) return true; }
    catch (cause) { setError(String(cause)); return false; }
    if (!host.canSaveOriginal(file.rootId)) { setNotice("目录快照不能保存原文件，请导出副本。"); return false; }
    busy.current = true; setSaving(true); setError("");
    try {
      const result = await saveLocalSource({ submitted: current(), base: baseRef.current, currentSource: current,
        write: (text, snapshot) => host.write(file.rootId, file.node.id, text, snapshot),
        committed: saved => { baseRef.current = saved; setBase(saved); setExternal(null); },
        clearDraft: () => host.drafts.remove(identity),
        keepDraft: (text, saved) => host.drafts.write({ identity, source: text, baseSource: saved.source, baseRevision: saved.revision, bom: saved.bom, lineEnding: saved.lineEnding, savedAt: Date.now() }),
      });
      if (result.recoveryIssue) setError(result.recoveryIssue);
      else setNotice("");
      return result.clean && !result.recoveryIssue;
    } catch (cause) {
      if (cause instanceof BufferSaveCancelled) return false;
      if (String(cause).includes("STALE_REVISION")) {
        setExternal(await host.read(file.rootId, file.node.id).catch(() => null));
        setError("磁盘文件已变化，未覆盖。请比较后导出副本或重新读取磁盘文件。");
      } else setError(String(cause));
      return false;
    } finally { busy.current = false; setSaving(false); }
  }, [current, host, file.rootId, file.node.id, identity, candidate, untitled]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!active || event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.shiftKey || document.querySelector("dialog[open], [role=dialog]")) return;
      if (!isPrimaryShortcutModifier(event)) return;
      if (event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
      if (event.key.toLowerCase() === "w" && !isTauriRuntime()) { event.preventDefault(); event.stopPropagation(); requestClose(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [save, active, requestClose]);
  useEffect(() => {
    if (!isTauriRuntime() || !active) return;
    let live = true, dispose: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => listen("workbench:close-file", () => { if (live && activeCurrent.current && !document.querySelector("dialog[open], [role=dialog]")) closeRequest.current?.(); }))
      .then(stop => { if (live) dispose = stop; else stop(); }).catch(cause => { if (live) setError(String(cause)); });
    return () => { live = false; dispose?.(); };
  }, [closeRequest, active]);
  const copy = async () => { try { await exportLocalSource(file.node.name, current(), baseRef.current, host.saveCopy); } catch (cause) { setError(String(cause)); } };
  const keepAndLeave = async () => {
    try { await checkpoint(); const target = leave; setLeave(null); if (target === "close") finishClose(); else await read(); }
    catch (cause) { setError(String(cause)); }
  };
  const searchLocation = useRef(file.location), appliedSearch = useRef(false);
  useEffect(() => {
    if (navigationRequest === undefined || !file.location) return;
    const location = file.location;
    searchLocation.current = location; appliedSearch.current = false;
    if (!baseRef.current) return; // Initial load is handled by bindHandle.
    if (baseRef.current.revision !== location.revision || current() !== baseRef.current.source) return;
    if (renderMode.current) changePreviewMode(false);
    const frame = requestAnimationFrame(() => {
      const editor = handle.current;
      if (!editor) return;
      editor.setSelectionRange(Math.min(location.from, editor.value.length), Math.min(location.to, editor.value.length));
      editor.scrollToOffset(Math.min(location.from, editor.value.length), true); appliedSearch.current = true;
    });
    return () => cancelAnimationFrame(frame);
    // A retained session receives a new navigation token only for an explicit open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationRequest]);
  // Source surface owns the live editor/session. A changing callback would
  // recreate it on every keystroke and restore obsolete compartments/history.
  const bindHandle = useCallback((editor: SourceEditorHandle | null) => {
    const location = searchLocation.current, snapshot = baseRef.current;
    onSourceReady(editor);
    if (editor && activeCurrent.current && !renderMode.current && !readonlyCurrent.current) {
      requestAnimationFrame(() => {
        if (handle.current === editor && activeCurrent.current && !renderMode.current && !readonlyCurrent.current && !document.querySelector("dialog[open], [role=dialog]")) editor.focus();
      });
    }
    if (!editor || appliedSearch.current || !location || !snapshot) return;
    appliedSearch.current = true;
    if (snapshot.revision !== location.revision || current() !== snapshot.source) return;
    editor.setSelectionRange(Math.min(location.from, editor.value.length), Math.min(location.to, editor.value.length));
    editor.scrollToOffset(Math.min(location.from, editor.value.length), true);
  }, [current, onSourceReady, handle]);
  const editable = !loading && Boolean(base) && !candidate && draftAvailable;
  const toolsPreference = useFocusEditorTools(state => state.expanded);
  const setMoreTools = useFocusEditorTools(state => state.setExpanded);
  const moreTools = toolsPreference ?? true;
  const [navigationTarget, setNavigationTarget] = useState<HTMLSpanElement | null>(null);
  const accessToggle = <DocumentAccessToggle readonly={readonly} aria-label={readonly ? "允许编辑" : "设为只读"} title={readonly ? "允许编辑" : "设为只读"} disabled={!editable} onClick={() => setReadonly(value => !value)} />;
  const unsupported = !base && /UTF-8|二进制/.test(error);
  const loadFileDetails=useCallback((signal:AbortSignal)=>provider.details ? provider.details(file.rootId,file.node.id,signal) : provider.properties(file.rootId,file.node.id,signal),[provider,file.rootId,file.node.id]);
  const fileDetails=useLocalFileDetails(identity,loadFileDetails,base,active);
  const titleInfo = { title: file.node.name, tags: [], path: documentPath ?? file.node.id, readonly, contentBytes: base?.size ?? file.node.size, ...localFileInfoTimes(fileDetails,base), format: DOCUMENT_LANGUAGE_OPTIONS.find(option => option.value === language)?.label ?? language };
  const titleActions = <>
    <button className="btn-icon" type="button" aria-label="编辑器排版" title="编辑器排版" onClick={() => setTypographyOpen(true)}><ToolbarIcon name="sliders" /></button>
    {onNavigate && <><button className="btn-icon" type="button" aria-label="上一文件" title="上一文件（←，只读预览）" disabled={!previous} onClick={() => requestClose(() => onNavigate(-1))}><ToolbarIcon name="chevronLeft" /></button><button className="btn-icon" type="button" aria-label="下一文件" title="下一文件（→，只读预览）" disabled={!next} onClick={() => requestClose(() => onNavigate(1))}><ToolbarIcon name="chevronRight" /></button></>}
    <button className="btn-icon" type="button" aria-label="保存文件" title="保存文件（⌘/Ctrl+S）" disabled={loading || !dirty || saving || !host.canSaveOriginal(file.rootId)} onClick={() => void save()}><ToolbarIcon name="save" /></button>
    <button className="btn-icon" type="button" aria-label="导出副本" title="导出副本" disabled={loading || !base} onClick={() => void copy()}><ToolbarIcon name="download" /></button>
    <button className="btn-icon" type="button" aria-label="重新读取原文件" title="重新读取原文件" disabled={untitled || loading || saving} onClick={() => { if (dirty) setLeave("reload"); else void read(); }}><ToolbarIcon name="refresh" /></button>
    {headerActions}
    {beforeCloseActions}
    <button className="btn-icon workbench-file-close" type="button" aria-label={closeLabel} title={closeLabel === "返回文件浏览" ? "关闭预览，返回文件浏览" : closeLabel} onClick={() => requestClose()}><ToolbarIcon name="close" /></button>
  </>;
  return <section ref={previewRoot} style={workbenchTypographyVariables(typography) as React.CSSProperties} tabIndex={-1} className="local-file-view workbench-source-view" data-source-tools-hidden={!moreTools || undefined} aria-label="文件源码工作区" onClickCapture={event => {
    const href = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]")?.getAttribute("href") : null;
    if (markdown && href && !href.startsWith("#") && !/^(https?:|mailto:|tel:)/i.test(href)) {
      event.preventDefault(); event.stopPropagation(); setNotice("请从文件列表打开本地链接；不会跳离当前编辑会话。");
    }
  }} onKeyDownCapture={event => {
    if (!readonly || !onNavigate || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !["ArrowLeft", "ArrowRight"].includes(event.key) || (event.target as Element).closest("input, textarea, select, dialog, [role=dialog]")) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === "ArrowLeft" ? previous : next) requestClose(() => onNavigate(event.key === "ArrowLeft" ? -1 : 1));
  }}>
    {!renderMarkdown && <DocumentTitleBar className="local-files-toolbar local-file-titlebar">{accessToggle}<DocumentTitleField title={file.node.name} modified={dirty} preview revealOnClick={false} readonly={readonly} info={titleInfo} />
      {markdown && <FileBrowserMarkdownMode rendered={renderMarkdown} disabled={!base} onChange={changePreviewMode} />}
      <span ref={setNavigationTarget} className="workbench-navigation-actions" /><MoreToolsButton className="btn-icon" expanded={moreTools} onToggle={() => setMoreTools(!moreTools)} /><PanelSideToggle />
      {titleActions}
    </DocumentTitleBar>}
    {loading && <p role="status">正在读取文件…</p>}
    {error && !base && <>{unsupported && <p>此文件暂时无法内置预览，可使用其它应用打开。</p>}<FileBrowserFileDetails rootId={file.rootId} node={file.node.id} provider={provider} /></>}
    {error && !unsupported && !external && !leave && active && <WorkspaceDialog title="文件操作异常" onClose={() => setError("")}><p role="alert">{error}</p></WorkspaceDialog>}
    {notice && active && <WorkspaceDialog title="文件提示" onClose={() => setNotice("")}><p role="status">{notice}</p></WorkspaceDialog>}
    {candidate && <div role="status">发现此会话未保存草稿。<button type="button" onClick={() => { change(candidate.source); applyBase({ ...base!, source: candidate.baseSource, revision: candidate.baseRevision, bom: candidate.bom, lineEnding: candidate.lineEnding }); setCandidate(null); setReadonly(false); setSourceMounted(true); renderMode.current = false; setRenderMarkdown(false); }}>恢复草稿</button><button type="button" onClick={() => { void exportLocalSource(file.node.name, candidate.source, candidate, host.saveCopy).catch(cause => setError(String(cause))); }}>下载草稿</button><button type="button" onClick={() => { void host.drafts.remove(identity).then(() => setCandidate(null)).catch(cause => setError(String(cause))); }}>删除草稿</button></div>}
    {!loading && base && markdown && renderMounted && <div className="workbench-rendered-session" hidden={!renderMarkdown}>
      <DocumentImageLibraryContext.Provider value={false}><EditorFoldIconContext.Provider value={editorSettings}>
        <Suspense fallback={<p role="status">正在加载 Markdown 编辑器…</p>}><MarkdownWorkspace key={`${identity}:${renderEpoch}`} identity={`workbench:${identity}`} onCreateDocument={onCreateDocument} createDocumentLabel="新建文件" onError={setError} modified={dirty} source={source} title={file.node.name} active={active && renderMarkdown} readonly={readonly || !editable || !renderMarkdown || !active} focusMode={false} fontSize={typography.note_font_size} vimModeEnabled={false} useCustomContextMenu showStatusBlockNumber highlightActiveLine showLineNumbers={editorSettings.editor_show_line_numbers} onEditorConfigChange={async patch => { setEditorSettings(saveWorkbenchEditorSettings(settings, editorSettings, patch)); }} showStatusBar defaultCodeBlockWrap cjkLatinSpacing={false} readonlyHeadingFoldInFocusMode={false}
          bookmarks={lineBookmarks.map(item => ({ offset: item.position, line: source.slice(0, item.position).split("\n").length, label: item.label || item.preview }))} onBookmarksChange={items => setLineBookmarks(items.map(item => ({ id: String(item.offset), position: item.offset, label: item.label, preview: item.label })))} onSourceChange={renderedChange} onPending={() => setRenderPending(true)} onRegisterFlush={registerRenderedFlush} onEditorReady={bindRendered} separateTitle titleRevealOnClick={false} pdfExport={false} onExportMarkdown={copy} onClick={() => {}} onReadonlyChange={editable ? setReadonly : undefined} resolveResource={resolveResource} saveStatus={saving ? "saving" : dirty ? "dirty" : "clean"}
          info={titleInfo} titleActions={titleActions} viewToggle={<FileBrowserMarkdownMode rendered onChange={changePreviewMode} />} />
        </Suspense>
      </EditorFoldIconContext.Provider></DocumentImageLibraryContext.Provider>
    </div>}
    {!loading && base && sourceMounted && <div className="local-file-editor-shell workbench-source-session" style={{ "--editor-font-family": blockFontFamily(typography.source_font_family), "--editor-source-font-family": blockFontFamily(typography.source_font_family) } as React.CSSProperties} hidden={renderMarkdown}><DocumentNavigationWorkspace origin="local" revision={sourceNavigation} bookmarkItems={lineBookmarks.map(item => ({ ...item, offset: item.position, blockNumber: source.slice(0, item.position).split("\n").length }))} sourceHandle={position.sourceHandle} onJump={offset => { handle.current?.setSelectionRange(offset, offset); handle.current?.scrollToOffset(offset, true); }} onToggleBookmark={offset => setLineBookmarks(items => items.some(item => item.position === offset) ? items.filter(item => item.position !== offset) : [...items, { id: crypto.randomUUID(), position: offset, label: "", preview: source.slice(offset, offset + 80) }])} onRemoveBookmark={id => setLineBookmarks(items => items.filter(item => item.id !== id))} onRenameBookmark={(id, label) => setLineBookmarks(items => items.map(item => item.id === id ? { ...item, label } : item))}>{controls => <>{navigationTarget && createPortal(controls, navigationTarget)}<DocumentActiveBoundary active={active && !renderMarkdown}><EditorFoldIconContext.Provider value={editorSettings}><DocumentSourceSurface editor={{ value: sourceProjection.current, readonly: readonly || renderMarkdown || !active, areaRef: handle, session, onChange: change, fontSize: typography.note_font_size, highlightActiveLine: true, showLineNumbers: editorSettings.editor_show_line_numbers, onEditorConfigChange: async patch => { setEditorSettings(saveWorkbenchEditorSettings(settings, editorSettings, patch)); }, showStatusBar: true, contextMenuEnabled: true, onCreateDocument, createDocumentLabel: "新建文件", documentLanguage: language, documentLanguageValue: languageOverride ?? AUTO_DOCUMENT_LANGUAGE, documentLanguageOptions: documentLanguageViewOptions(detectedLanguage), onDocumentLanguageChange: value => {
        try { saveWorkbenchFileLanguage(settings, identity, value); setLanguageOverride(value === AUTO_DOCUMENT_LANGUAGE ? null : value); }
        catch (cause) { setError(String(cause)); }
      }, saveStatus: saving ? "saving" : dirty ? "dirty" : "clean", savedLabel: "保存到原文件；不参与数据库备份", navigation: null,
      onReady: bindHandle,
    }} /></EditorFoldIconContext.Provider></DocumentActiveBoundary></>}</DocumentNavigationWorkspace></div>}
    {typographyOpen && <TypographySettings value={typography} store={settings} onClose={() => setTypographyOpen(false)} />}
    {external && <WorkspaceDialog title="磁盘版本比较" onClose={() => setExternal(null)}><p role="alert">{error}</p><TextDiffView left={source} right={external.source} leftLabel="当前编辑" rightLabel="磁盘版本" /></WorkspaceDialog>}
    {leave && <WorkspaceDialog title="未保存的文件编辑" onClose={cancelLeave}>{error && <p role="alert">{error}</p>}<p>{persistDocument ? "首次保存时选择文件位置；也可保留本机编辑文档，下次启动会恢复。删除本机编辑草稿需通过标签菜单明确确认。" : "请先保存到原文件，或确认恢复草稿已持久化后离开。导出副本不会将原文件标记为已保存。最多保留 5 份草稿，不自动淘汰；满额时须先处理旧草稿。"}</p><div>
      <button type="button" disabled={saving || !host.canSaveOriginal(file.rootId)} onClick={() => { void save().then(clean => { if (clean) { const target = leave; setLeave(null); if (target === "close") finishClose(); else void read(); } }); }}>保存后继续</button>
      <button type="button" disabled={saving} onClick={() => void keepAndLeave()}>保留草稿后继续</button><button type="button" onClick={cancelLeave}>取消</button>
    </div></WorkspaceDialog>}
  </section>;
}
