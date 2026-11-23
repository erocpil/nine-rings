import { navigationKey } from "../../lib/document-navigation";
import { MarkdownLinkCheckDialog } from "./MarkdownLinkCheckDialog";
import { applyMarkdownLinkEdits } from "../../lib/local-files/markdown-link-repair";
import { canFollowMarkdownLink, localMarkdownLink, type LocalMarkdownLink } from "../../lib/local-files/markdown-links";
import { markdownAnchorOffsets } from "../../lib/local-files/markdown-link-anchors";
import type { WorkbenchRelocationRequest, WorkbenchEditorPort } from "./editor-window";
import type { LinkViewPosition, LinkRequest } from "./link-navigation";
import { setNavigationSelection } from "../../hooks/useEditorNavigation";
import { TOOLBAR_PREFERENCES_ERROR } from "./toolbar-preferences";
import { BufferSaveCancelled } from "./buffer-documents";
import { MoreToolsButton } from "../../components/MoreToolsButton";
import { useFocusEditorTools } from "../../stores/useFocusEditorTools";
import { isPrimaryShortcutModifier } from "../../lib/shortcuts";
import { isTauriRuntime } from "../../lib/runtime";
import { WorkbenchEditorSettingsDialog } from "./EditorSettings";
import { useWorkbenchTypography, workbenchTypographyVariables } from "./typography";
import { blockFontFamily } from "../../lib/editor-appearance";
import { useLocalFileDetails } from "../../hooks/useLocalFileDetails";
import { useDiskChange } from "../../hooks/useDiskChange";
import { DiskChangeNotice } from "../../components/DiskChangeNotice";
import { DiskChanges } from "../../lib/local-files/disk-changes";
import { useLocalMarkdownImages } from "../../hooks/useLocalMarkdownImages";
import { useNativeMenuActions } from "../../hooks/useNativeMenuActions";
import { useDocumentPreview } from "../../hooks/useDocumentPreview";
import { useMobileViewport } from "../../hooks/useEdgeDrawer";
import { DocumentPreviewControls } from "../../components/DocumentPreviewControls";
import { MarkdownSplitPreview } from "../../components/MarkdownSplitPreview";
import { localFileInfoTimes } from "../../lib/local-files/file-info-times";
import { DocumentTitleField } from "../../components/DocumentTitleField";
import { PanelSideToggle } from "../../components/PanelSideToggle";
import { createPortal } from "react-dom";
import { DocumentNavigationWorkspace } from "../../components/DocumentNavigationWorkspace";
import { SourceNavigationDocument, type SourceEditRange } from "../../lib/markdown-source-navigation";
import { remapLocalFileBookmarks } from "../../lib/local-files/bookmark-positions";
import { useMarkdownViewPosition } from "../../hooks/useMarkdownViewPosition";
import { prepareLocalMarkdownView } from "../../lib/local-files/markdown-view-switch";
import { DocumentImageLibraryContext, DocumentResourceContext } from "../../components/DocumentResourceContext";
import type { Editor } from "@tiptap/core";
import type { LocalRenderedFlush } from "../../components/LocalMarkdownWorkspace";
import { EditorFoldIconContext } from "../../components/EditorFoldIconContext";
import { readWorkbenchEditorSettings, saveWorkbenchEditorSettings, readWorkbenchFileLanguage, saveWorkbenchFileLanguage, readWorkbenchFileView, saveWorkbenchFileView, EDITOR_SETTINGS_EVENT } from "./editor-settings";
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
import { WorkspaceDialog } from "../../components/WorkspaceDialog";
import { AUTO_DOCUMENT_LANGUAGE, DOCUMENT_LANGUAGE_OPTIONS, documentLanguageViewOptions, documentLanguageFromFilename } from "../../lib/document-language";
import type { SourceEditorHandle } from "../../lib/source-editor-handle";
import type { BrowserFileOpen } from "../../lib/local-files/browser-contract";
import type { LocalFileSnapshot } from "../../lib/local-files/file-model";
import type { LocalSourceHost } from "../../lib/local-files/source-host";
import { saveLocalSource } from "../../lib/local-files/source-save";
import { checkpointLocalSource } from "../../lib/local-files/source-checkpoint";
import { exportLocalSource } from "../../lib/local-files/source-download";
import type { LocalFileDraft } from "../../lib/local-files/recovery";
import "../../styles/local-files.css";

const MarkdownWorkspace = lazy(() => import("../../components/LocalMarkdownWorkspace").then(module => ({ default: module.LocalMarkdownWorkspace })));

export function WorkbenchSourceView({ file, host, provider, settings, onClose, closeRequest, onNavigate, headerActions, previous = false, next = false, active = true, closeLabel = "返回文件浏览", onCloseCancelled, onDirtyChange, navigationRequest, beforeCloseActions, onCreateDocument, untitled = false, initialReadonly = true, documentPath, persistDocument = false, onFollowFile, linkRequest, onLinkHistory, linkHistory, linkOrigin, relocation, relocationReply, diskChanges, diskChangeId, onDiskNoticeTarget }: {
  onDiskNoticeTarget?: (node: HTMLDivElement | null) => void;
  diskChanges?: DiskChanges;
  diskChangeId?: string;
  relocation?: WorkbenchRelocationRequest;
  relocationReply?: WorkbenchEditorPort["relocationReply"];
  linkOrigin?: { rootId: string; node: string; read: LocalSourceHost["read"] };
  onFollowFile?: (target: LocalMarkdownLink & { sameFile: boolean; rootId: string }, origin: LinkViewPosition, leave: (next: () => void) => void) => Promise<void>;
  linkRequest?: LinkRequest;
  onLinkHistory?: (direction: -1 | 1, origin: LinkViewPosition, leave: (next: () => void) => void) => void;
  linkHistory?: { back: boolean; forward: boolean };
  beforeCloseActions?: ReactNode;
  onCreateDocument?: () => void;
  untitled?: boolean; initialReadonly?: boolean; documentPath?: string; persistDocument?: boolean;
  navigationRequest?: number;
  active?: boolean; closeLabel?: string; onCloseCancelled?: () => void; onDirtyChange?: (dirty: boolean) => void;
  settings: BrowserSettingsStore;
  headerActions?: ReactNode;
  file: BrowserFileOpen & { relocatedFrom?: string }; host: LocalSourceHost; provider: BrowserDirectoryProvider; onClose: () => void;
  closeRequest: MutableRefObject<WorkbenchCloseRequest | null>;
  onNavigate?: (direction: -1 | 1) => void; previous?: boolean; next?: boolean;
}) {
  const typography = useWorkbenchTypography(settings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editorSettings, setEditorSettings] = useState(() => readWorkbenchEditorSettings(settings));
  useEffect(() => {
    const sync = () => setEditorSettings(readWorkbenchEditorSettings(settings));
    window.addEventListener(EDITOR_SETTINGS_EVENT, sync);
    window.addEventListener("storage", sync);
    sync();
    return () => { window.removeEventListener(EDITOR_SETTINGS_EVENT, sync); window.removeEventListener("storage", sync); };
  }, [settings]);
  const identity = `${file.rootId}:${file.node.id}`;
  const initialView = useMemo(() => readWorkbenchFileView(settings, identity), [settings, identity]);
  const [source, setSource] = useState(""), sourceRef = useRef("");
  const [languageOverride, setLanguageOverride] = useState(() => readWorkbenchFileLanguage(settings, identity));
  const sessionName = useRef(file.node.name);
  const renderedSession = useRef(identity);
  const detectedLanguage = documentLanguageFromFilename(persistDocument ? file.node.name : sessionName.current, source);
  const language = languageOverride ?? detectedLanguage;
  const markdown = language === "markdown";
  const startsRendered = markdown && !file.location && initialView.rendered !== false;
  const [renderMarkdown, setRenderMarkdown] = useState(startsRendered);
  const split = useDocumentPreview();
  const mobile = useMobileViewport();
  const splitVisible = active && markdown && !mobile && !renderMarkdown && split.preview;
  const [renderMounted, setRenderMounted] = useState(startsRendered);
  const [sourceMounted, setSourceMounted] = useState(!startsRendered);
  const previewRoot = useRef<HTMLElement>(null);
  const position = useMarkdownViewPosition(`workbench:${identity}`, !renderMarkdown, false, previewRoot);
  const { area: handle, onSourceReady } = position;
  const positionRef = useRef(position); positionRef.current = position;
  const session = useRef<EditorState | null>(null);
  const reloadPosition = useRef<LinkViewPosition>();
  const parkedScroll = useRef<{ rendered?: { top: number; left: number }; source?: { top: number; left: number } }>({});
  const renderedScroller = useCallback(() => previewRoot.current?.querySelector<HTMLElement>(".workbench-rendered-session .note-editor-scroll"), []);
  const renderedEditor = useRef<Editor | null>(null);
  const readonlyCurrent = useRef(true);
  const activeCurrent = useRef(active); activeCurrent.current = active;
  const renderedFlush = useRef<LocalRenderedFlush | null>(null);
  const [renderPending, setRenderPending] = useState(false);
  const [renderEpoch, setRenderEpoch] = useState(0);
  const resourceNode = linkOrigin?.node ?? (persistDocument ? undefined : file.node.id);
  const resolveResource = useLocalMarkdownImages(provider, linkOrigin?.rootId ?? file.rootId, active && (renderMarkdown || splitVisible) ? resourceNode : undefined, renderEpoch);
  const renderMode = useRef(renderMarkdown); renderMode.current = renderMarkdown;
  const registerRenderedFlush = useCallback((value: LocalRenderedFlush | null) => { renderedFlush.current = value; }, []);
  const restoreReloadPosition = useCallback(() => {
    const saved = reloadPosition.current;
    if (!saved || !activeCurrent.current || saved.rendered !== renderMode.current) return;
    const rendered = renderedEditor.current;
    const source = handle.current;
    if (saved.rendered ? !rendered || rendered.isDestroyed : !source) return;
    reloadPosition.current = undefined;
    if (saved.rendered && rendered) {
      const end = rendered.state.doc.content.size;
      setNavigationSelection(rendered, { from: Math.max(1, Math.min(saved.from, end)), to: Math.max(1, Math.min(saved.to, end)) });
      renderedScroller()?.scrollTo({ top: saved.top, left: saved.left });
    } else if (source) {
      source.setSelectionRange(Math.min(saved.from, source.value.length), Math.min(saved.to, source.value.length));
      source.view.scrollDOM.scrollTo({ top: saved.top, left: saved.left });
    }
  }, [handle, renderedScroller]);
  useEffect(() => {
    if (!active || !reloadPosition.current) return;
    const frame = requestAnimationFrame(restoreReloadPosition);
    return () => cancelAnimationFrame(frame);
  }, [active, renderEpoch, restoreReloadPosition]);
  const bindRendered = useCallback((editor: Editor | null) => {
    renderedEditor.current = editor; positionRef.current.onRenderedReady(editor);
    if (editor && reloadPosition.current) requestAnimationFrame(restoreReloadPosition);
    if (editor && activeCurrent.current && renderMode.current && !document.querySelector("dialog[open]")) {
      if (readonlyCurrent.current) previewRoot.current?.focus({ preventScroll: true });
      else requestAnimationFrame(() => { if (activeCurrent.current && renderMode.current && renderedEditor.current === editor && !editor.isDestroyed && !document.querySelector("dialog[open]")) editor.view.focus(); });
    }
  }, [restoreReloadPosition]);
  const capturePosition = useCallback((): LinkViewPosition => {
    if (renderMode.current) {
      const selection = renderedEditor.current?.state.selection;
      const scroll = renderedScroller();
      const offset = scroll?.isConnected ? { top: scroll.scrollTop, left: scroll.scrollLeft } : parkedScroll.current.rendered;
      return { rendered: true, from: selection?.from ?? 0, to: selection?.to ?? 0, top: offset?.top ?? 0, left: offset?.left ?? 0 };
    }
    const editor = handle.current;
    const selection = editor?.view.state.selection.main;
    const scroll = editor?.view.scrollDOM;
    const offset = scroll?.isConnected ? { top: scroll.scrollTop, left: scroll.scrollLeft } : parkedScroll.current.source;
    return { rendered: false, from: selection?.anchor ?? 0, to: selection?.head ?? 0, top: offset?.top ?? 0, left: offset?.left ?? 0 };
  }, [handle, renderedScroller]);
  const current = useCallback(() => { renderedFlush.current?.flush(); return sourceRef.current; }, []);
  const changePreviewMode = (value: boolean) => {
    if (value === renderMode.current) return;
    try {
      prepareLocalMarkdownView({
        rendered: value, readSource: current, position,
        readRenderedSelection: () => renderedEditor.current?.state.selection.from,
        prepareSource: text => {
          const editor = handle.current;
          if (editor && editor.value !== text) editor.insertIsolated(0, editor.view.state.doc.length, text);
        },
        persist: () => saveWorkbenchFileView(settings, identity, { rendered: value }),
      });
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
  const [readonly, setReadonlyState] = useState(initialView.readonly ?? initialReadonly), [loading, setLoading] = useState(true);
  const setReadonly = useCallback((value: boolean | ((previous: boolean) => boolean)) => {
    const next = typeof value === "function" ? value(readonlyCurrent.current) : value;
    try { saveWorkbenchFileView(settings, identity, { readonly: next }); readonlyCurrent.current = next; setReadonlyState(next); }
    catch (cause) { setError(`无法保存只读状态：${String(cause)}`); }
  }, [settings, identity]);
  readonlyCurrent.current = readonly || Boolean(relocation);
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
  useEffect(() => {
    const failed = (event: Event) => { if (activeCurrent.current) setError(String((event as CustomEvent<string>).detail)); };
    window.addEventListener(TOOLBAR_PREFERENCES_ERROR, failed);
    return () => window.removeEventListener(TOOLBAR_PREFERENCES_ERROR, failed);
  }, []);
  const [saving, setSaving] = useState(false), busy = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const reading = useRef(false);
  const loadedFile = useRef<{ identity: string; host: LocalSourceHost }>();
  const movePosition = useRef<LinkViewPosition>();
  const acknowledgedRelocation = useRef<number>();
  const [diskNoticeTarget, setDiskNoticeTarget] = useState<HTMLDivElement | null>(null);
  const diskNoticeSlot = active ? <div className="disk-change-slot" ref={onDiskNoticeTarget ?? setDiskNoticeTarget} /> : null;
  const [diskIssue, setDiskIssue] = useState("");
  const changeId = diskChangeId ?? identity;
  const [leave, setLeave] = useState<"close" | "reload" | null>(null);
  const [draftAvailable, setDraftAvailable] = useState(true);
  const [candidate, setCandidate] = useState<LocalFileDraft | null>(null);
  const dirty = Boolean(base && (untitled || source !== base.source || renderPending));
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const change = useCallback((text: string, range?: SourceEditRange) => {
    const before = sourceRef.current;
    setLineBookmarks(items => remapLocalFileBookmarks(items, before, text, (item, mapOffset) => ({ ...item, position: mapOffset(item.position) }), range));
    sourceRef.current = text; setSource(text);
  }, []);
  useEffect(() => {
    try { settings.setItem(`bookmarks:${identity}`, JSON.stringify(lineBookmarks)); }
    catch { setNotice("书签未能保存到本机，请检查存储空间。 "); }
  }, [identity, lineBookmarks, settings]);
  const renderedChange = (text: string) => { change(text); setRenderPending(false); };
  const applyBase = (snapshot: LocalFileSnapshot) => { baseRef.current = snapshot; setBase(snapshot); };
  const checkpoint = useCallback(() => checkpointLocalSource({
    identity, drafts: host.drafts, retainClean: persistDocument,
    read: () => ({ source: current(), base: baseRef.current }),
    isSaving: () => busy.current,
  }), [current, host, identity, persistDocument]);
  const [previewDiskChanges] = useState(() => new DiskChanges());
  const changeStore = diskChanges ?? previewDiskChanges;
  const read = useCallback(async () => {
    if (reading.current || busy.current) return;
    reading.current = true;
    setLoading(true); setError("");
    try {
      const snapshot = await host.read(file.rootId, file.node.id);
      let draft: LocalFileDraft | null = null;
      try { draft = await host.drafts.read(identity); setDraftAvailable(true); }
      catch (cause) { setDraftAvailable(false); setNotice(`恢复草稿不可用，暂时只读：${String(cause)}`); }
      setCandidate(draft?.source !== snapshot.source ? draft : null);
      sourceRef.current = snapshot.source; sourceProjection.current = snapshot.source; setSource(snapshot.source); baseRef.current = snapshot; setBase(snapshot);
      session.current = null; setRenderEpoch(value => value + 1); setRenderPending(false); changeStore.clear(changeId); setDiskIssue(""); setReadonlyState(readWorkbenchFileView(settings, identity).readonly ?? initialReadonly);
    } catch (cause) { setError(String(cause)); }
    finally { reading.current = false; setLoading(false); }
  }, [file.rootId, file.node.id, host, identity, initialReadonly, settings, changeStore, changeId]);
  useEffect(() => {
    let live = true;
    if (loadedFile.current?.identity === identity && loadedFile.current.host === host) return;
    if (file.relocatedFrom && loadedFile.current?.identity === file.relocatedFrom && loadedFile.current.host === host && baseRef.current) {
      loadedFile.current = { identity, host };
      const saved = movePosition.current;
      movePosition.current = undefined;
      if (!saved) return;
      const frame = requestAnimationFrame(() => {
        if (saved.rendered) {
          const editor = renderedEditor.current;
          if (editor && !editor.isDestroyed) setNavigationSelection(editor, { from: saved.from, to: saved.to });
          renderedScroller()?.scrollTo({ top: saved.top, left: saved.left });
        } else {
          handle.current?.setSelectionRange(saved.from, saved.to);
          handle.current?.view.scrollDOM.scrollTo({ top: saved.top, left: saved.left });
        }
      });
      return () => cancelAnimationFrame(frame);
    }
    void host.read(file.rootId, file.node.id).then(async snapshot => {
      const recovery = await host.drafts.read(identity).then(draft => ({ draft, issue: "" })).catch(cause => ({ draft: null, issue: String(cause) }));
      if (!live) return;
      const draft = recovery.draft;
      loadedFile.current = { identity, host };
      setDraftAvailable(!recovery.issue);
      if (recovery.issue) setNotice(`恢复草稿不可用，暂时只读：${recovery.issue}`);
      sourceRef.current = snapshot.source; sourceProjection.current = snapshot.source; setSource(snapshot.source); baseRef.current = snapshot; setBase(snapshot); setCandidate(draft?.source !== snapshot.source ? draft : null); setLoading(false);
    }).catch(cause => { if (live) { setError(String(cause)); setLoading(false); } });
    return () => { live = false; };
  }, [host, identity, file.rootId, file.node.id, file.relocatedFrom, handle, renderedScroller]);
  useEffect(() => {
    if (!relocation || !relocationReply || acknowledgedRelocation.current === relocation.token) return;
    let live = true;
    const respond = async () => {
      let revision: string | undefined;
      let reason: string | undefined;
      try {
        const baseline = baseRef.current;
        if (!baseline || loading || busy.current || reading.current || candidate || !draftAvailable || leave || changeStore.conflict()?.id === changeId ||
            handle.current?.view.composing || renderedEditor.current?.view.composing || document.querySelector("dialog[open], [role=dialog]")) {
          throw new Error("标签正在编辑或处理对话框，请完成后再移动。");
        }
        if ((handle.current && !handle.current.view.state.readOnly) || renderedEditor.current?.isEditable) {
          throw new Error("无法暂停标签写入，请稍后重试。");
        }
        if (current() !== baseline.source || await host.drafts.read(identity)) {
          throw new Error("此标签有未保存内容或恢复草稿，请保存或处理草稿后再移动。");
        }
        if (!live) return;
        if (baseRef.current !== baseline || current() !== baseline.source || busy.current || reading.current) {
          throw new Error("编辑或磁盘版本已发生变化，请重新移动。");
        }
        movePosition.current = capturePosition();
        revision = baseline.revision;
      } catch (cause) { reason = String(cause); }
      if (!live) return;
      acknowledgedRelocation.current = relocation.token;
      await relocationReply(relocation.token, revision, reason);
    };
    // Wait until the retained source and rendered surfaces have applied their
    // readonly effects. A backend lease already blocks writes to both paths.
    queueMicrotask(() => { if (live) void respond().catch(cause => { if (live) setError(String(cause)); }); });
    return () => { live = false; };
  }, [relocation, relocationReply, loading, candidate, draftAvailable, leave, changeStore, changeId, host, identity, current, capturePosition, handle]);
  useDiskChange({
    store: changeStore,
    id: changeId,
    name: file.node.name,
    path: documentPath ?? diskChangeId ?? file.node.id,
    active,
    dirty,
    enabled: (active || Boolean(diskChanges)) && !relocation && !untitled && !loading && Boolean(base) && !candidate && !leave,
    baseline: () => baseRef.current,
    canCheck: () => mounted.current && !busy.current && !reading.current && !handle.current?.view.composing && !renderedEditor.current?.view.composing,
    stat: host.stat?.bind(host, file.rootId, file.node.id),
    read: () => host.read(file.rootId, file.node.id),
    readCurrent: current,
    saveCopy: () => { void copy(); },
    canDiscard: true,
    apply(next, baseline) {
      if (next.source !== baseline.source) {
        reloadPosition.current = capturePosition();
        session.current = null;
        setRenderEpoch(value => value + 1);
      }
      baseRef.current = next; setBase(next);
      sourceProjection.current = next.source; change(next.source);
      setRenderPending(false); setDiskIssue("");
      if (persistDocument) {
        void host.drafts.write({ identity, source: next.source, baseSource: next.source, baseRevision: next.revision, bom: next.bom, lineEnding: next.lineEnding, savedAt: Date.now() })
          .catch(cause => { if (mounted.current) setNotice(`本机编辑记录更新失败：${String(cause)}`); });
      }
    },
    onRead() { setDiskIssue(""); },
    onError(cause) { if (active) setDiskIssue(`暂时无法重新读取磁盘文件，当前内容已保留。${String(cause)}`); },
  });
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
    if (relocation || busy.current || !baseRef.current) return false;
    if (candidate) { setNotice("请先处理已有恢复草稿，未执行保存。"); return false; }
    try { if (!untitled && current() === baseRef.current.source) return true; }
    catch (cause) { setError(String(cause)); return false; }
    if (!host.canSaveOriginal(file.rootId)) { setNotice("目录快照不能保存原文件，请导出副本。"); return false; }
    busy.current = true; setSaving(true); setError("");
    try {
      const result = await saveLocalSource({ submitted: current(), base: baseRef.current, currentSource: current,
        write: (text, snapshot) => host.write(file.rootId, file.node.id, text, snapshot),
        committed: saved => { baseRef.current = saved; setBase(saved); changeStore.clear(changeId); changeStore.dismissSaveConflict(changeId); setDiskIssue(""); },
        clearDraft: () => host.drafts.remove(identity),
        keepDraft: (text, saved) => host.drafts.write({ identity, source: text, baseSource: saved.source, baseRevision: saved.revision, bom: saved.bom, lineEnding: saved.lineEnding, savedAt: Date.now() }),
      });
      if (result.recoveryIssue) setError(result.recoveryIssue);
      else setNotice("");
      return result.clean && !result.recoveryIssue;
    } catch (cause) {
      if (cause instanceof BufferSaveCancelled) return false;
      if (String(cause).includes("STALE_REVISION")) {
        const snapshot = await host.read(file.rootId, file.node.id).catch(() => null);
        if (pendingClose.current || leave) {
          pendingClose.current = null;
          setLeave(null);
          onCloseCancelled?.();
        }
        if (mounted.current && changeStore.actions.has(changeId)) {
          changeStore.reportSaveConflict({ id: changeId, name: file.node.name, path: documentPath ?? diskChangeId ?? file.node.id }, snapshot);
        }
      } else setError(String(cause));
      return false;
    } finally { busy.current = false; setSaving(false); }
  }, [current, host, file.rootId, file.node.id, identity, candidate, untitled, relocation, changeStore, changeId, file.node.name, documentPath, diskChangeId, leave, onCloseCancelled]);
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
    if (editor && reloadPosition.current) requestAnimationFrame(restoreReloadPosition);
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
  }, [current, onSourceReady, handle, restoreReloadPosition]);
  const editable = !relocation && !loading && Boolean(base) && !candidate && draftAvailable;
  useNativeMenuActions({
    "document.save": { run: () => save(), enabled: editable && !readonly && dirty && !saving && host.canSaveOriginal(file.rootId) },
    "workbench.export-copy": { run: copy },
    "document.source": { run: () => changePreviewMode(!renderMarkdown), enabled: markdown, checked: !renderMarkdown },
  }, active && Boolean(base) && !loading);
  const toolsPreference = useFocusEditorTools(state => state.expanded);
  const setMoreTools = useFocusEditorTools(state => state.setExpanded);
  const moreTools = toolsPreference ?? true;
  const [navigationTarget, setNavigationTarget] = useState<HTMLSpanElement | null>(null);
  const accessToggle = <DocumentAccessToggle readonly={readonly} aria-label={readonly ? "允许编辑" : "设为只读"} title={readonly ? "允许编辑" : "设为只读"} disabled={!editable} onClick={() => setReadonly(value => !value)} />;
  const unsupported = !base && /UTF-8|二进制/.test(error);
  const loadFileDetails=useCallback((signal:AbortSignal)=>provider.details ? provider.details(file.rootId,file.node.id,signal) : provider.properties(file.rootId,file.node.id,signal),[provider,file.rootId,file.node.id]);
  const fileDetails=useLocalFileDetails(identity,loadFileDetails,base,active);
  const titleInfo = { title: file.node.name, tags: [], path: documentPath ?? file.node.id, readonly, contentBytes: base?.size ?? file.node.size, ...localFileInfoTimes(fileDetails,base), format: DOCUMENT_LANGUAGE_OPTIONS.find(option => option.value === language)?.label ?? language };
  const renderedNavigation = useRef<((fragment: string) => boolean) | null>(null);
  const [renderedLinkReady, setRenderedLinkReady] = useState(false);
  const bindHeadingNavigation = useCallback((navigate: ((fragment: string) => boolean) | null) => {
    renderedNavigation.current = navigate;
    setRenderedLinkReady(Boolean(navigate));
  }, []);
  const [linkNotice, setLinkNotice] = useState<{ message: string; offerStart?: boolean }>();
  const goToFileStart = () => {
    if (renderMarkdown) renderedScroller()?.scrollTo({ top: 0, left: 0 });
    else handle.current?.revealOffset(0);
  };
  const followingLink = useRef(false);
  const followLink = async (href: string) => {
    if (followingLink.current || !activeCurrent.current) return;
    followingLink.current = true;
    setLinkNotice(undefined);
    try {
      if (persistDocument && !linkOrigin && !href.startsWith("#")) throw new Error("当前文档没有可用于跳转的授权目录");
      const from = linkOrigin?.node ?? file.node.id;
      const target = localMarkdownLink(from, href);
      if (target.node !== from && !onFollowFile) throw new Error("当前文档没有可用于跳转的授权目录");
      if (onFollowFile) await onFollowFile({ ...target, sameFile: target.node === from, rootId: linkOrigin?.rootId ?? file.rootId }, capturePosition(), next => {
        if (mounted.current && activeCurrent.current) requestClose(next);
      });
      else if (!target.fragment) goToFileStart();
      else if (!jumpToFragment(target.fragment)) showMissingFragment(target.fragment);
    } catch (cause) {
      if (mounted.current && activeCurrent.current) setLinkNotice({ message: cause instanceof Error ? cause.message : String(cause) });
    } finally { followingLink.current = false; }
  };
  const jumpToFragment = (fragment: string) => {
    if (renderMode.current) return renderedNavigation.current?.(fragment) ?? false;
    const editor = handle.current;
    if (!editor) return false;
    const offset = markdownAnchorOffsets(editor.value).get(fragment);
    if (offset === undefined) return false;
    editor.revealOffset(offset);
    return true;
  };
  const showMissingFragment = (fragment: string) => setLinkNotice({ message: `找不到标题或锚点“${fragment}”。`, offerStart: true });
  const consumedLink = useRef<number>();
  const consumedOpenFragment = useRef<string>();
  const applyLinkRequest = useRef<() => void>(() => {});
  applyLinkRequest.current = () => {
    if (!active || !base) return;
    const ready = renderMarkdown ? renderedLinkReady : Boolean(handle.current);
    if (!linkRequest || consumedLink.current === linkRequest.serial) {
      if (!ready || !file.headingFragment) return;
      const token = `${navigationRequest ?? 0}\0${file.headingFragment}`;
      if (consumedOpenFragment.current === token) return;
      consumedOpenFragment.current = token;
      setLinkNotice(undefined);
      if (!jumpToFragment(file.headingFragment)) showMissingFragment(file.headingFragment);
      return;
    }
    const saved = linkRequest.position;
    if (saved && saved.rendered !== renderMarkdown) { changePreviewMode(saved.rendered); return; }
    if (!ready) return;
    consumedLink.current = linkRequest.serial;
    if (saved) {
      if (renderMarkdown) {
        const editor = renderedEditor.current;
        if (editor) setNavigationSelection(editor, { from: Math.max(1, Math.min(saved.from, editor.state.doc.content.size)), to: Math.max(1, Math.min(saved.to, editor.state.doc.content.size)) });
        renderedScroller()?.scrollTo({ top: saved.top, left: saved.left });
      } else {
        const editor = handle.current!;
        editor.setSelectionRange(Math.min(saved.from, editor.value.length), Math.min(saved.to, editor.value.length));
        editor.view.scrollDOM.scrollTo({ top: saved.top, left: saved.left });
      }
    } else if (linkRequest.start) {
      goToFileStart();
    } else if (linkRequest.fragment && !jumpToFragment(linkRequest.fragment)) {
      showMissingFragment(linkRequest.fragment);
    }
  };
  const linkSourceReady = position.sourceHandle;
  useEffect(() => {
    const frame = requestAnimationFrame(() => applyLinkRequest.current());
    return () => cancelAnimationFrame(frame);
  }, [active, base, linkRequest, renderMarkdown, renderedLinkReady, linkSourceReady, file.headingFragment, navigationRequest]);
  const historyControls = onLinkHistory && linkHistory ? <span className="workbench-link-navigation">
    <button type="button" className="btn-icon" title="链接后退" aria-label="链接后退" disabled={!linkHistory.back} onClick={() => onLinkHistory(-1, capturePosition(), requestClose)}><ToolbarIcon name="chevronLeft" /></button>
    <button type="button" className="btn-icon" title="链接前进" aria-label="链接前进" disabled={!linkHistory.forward} onClick={() => onLinkHistory(1, capturePosition(), requestClose)}><ToolbarIcon name="chevronRight" /></button>
  </span> : null;
  const [linkCheck, setLinkCheck] = useState<string | null>(null);
  const readLinkTarget = useCallback((node: string) => linkOrigin ? linkOrigin.read(linkOrigin.rootId, node) : host.read(file.rootId, node), [host, file.rootId, linkOrigin]);
  const titleActions = <>
    {historyControls}
    {markdown && (!persistDocument || linkOrigin) && <button type="button" className="btn-icon" aria-label="检查文档链接" title="检查文档链接" disabled={!base || loading} onClick={() => {
      try { setLinkCheck(current()); } catch (cause) { setLinkNotice({ message: String(cause) }); }
    }}><ToolbarIcon name="link" /></button>}
    <button className="btn-icon" type="button" aria-label="编辑器设置" title="编辑器设置" onClick={() => setSettingsOpen(true)}><ToolbarIcon name="sliders" /></button>
    {onNavigate && <><button className="btn-icon" type="button" aria-label="上一文件" title="上一文件（←，只读预览）" disabled={!previous} onClick={() => requestClose(() => onNavigate(-1))}><ToolbarIcon name="chevronLeft" /></button><button className="btn-icon" type="button" aria-label="下一文件" title="下一文件（→，只读预览）" disabled={!next} onClick={() => requestClose(() => onNavigate(1))}><ToolbarIcon name="chevronRight" /></button></>}
    <button className="btn-icon" type="button" aria-label="保存文件" title="保存文件（⌘/Ctrl+S）" disabled={Boolean(relocation) || loading || !dirty || saving || !host.canSaveOriginal(file.rootId)} onClick={() => void save()}><ToolbarIcon name="save" /></button>
    <button className="btn-icon" type="button" aria-label="导出副本" title="导出副本" disabled={loading || !base} onClick={() => void copy()}><ToolbarIcon name="download" /></button>
    <button className="btn-icon" type="button" aria-label="重新读取原文件" title="重新读取原文件" disabled={untitled || loading || saving} onClick={() => { if (dirty) setLeave("reload"); else void read(); }}><ToolbarIcon name="refresh" /></button>
    {headerActions}
    {beforeCloseActions}
    <button className="btn-icon workbench-file-close" type="button" aria-label={closeLabel} title={closeLabel === "返回文件浏览" ? "关闭预览，返回文件浏览" : closeLabel} onClick={() => requestClose()}><ToolbarIcon name="close" /></button>
  </>;
  return <EditorFoldIconContext.Provider value={editorSettings}><section ref={previewRoot} style={workbenchTypographyVariables(typography) as React.CSSProperties} tabIndex={-1} className="local-file-view workbench-source-view" data-source-tools-hidden={!moreTools || undefined} aria-label="文件源码工作区" onScrollCapture={event => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.isConnected) return;
    if (target === renderedScroller()) parkedScroll.current.rendered = { top: target.scrollTop, left: target.scrollLeft };
    if (target === handle.current?.view.scrollDOM) parkedScroll.current.source = { top: target.scrollTop, left: target.scrollLeft };
  }} onClickCapture={event => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    const href = anchor?.getAttribute("href");
    if (!markdown || !href || !canFollowMarkdownLink(href) || !event.currentTarget.contains(event.target as Node)) return;
    const inSplit = Boolean(anchor?.closest(".markdown-preview-scroll"));
    if (inSplit && href.startsWith("#")) return;
    event.preventDefault();
    if (!inSplit && !readonly && !isPrimaryShortcutModifier(event)) return;
    event.stopPropagation();
    void followLink(href);
  }} onKeyDownCapture={event => {
    const direction = navigationKey(event);
    if (direction && onLinkHistory && active && !event.nativeEvent.isComposing && !event.repeat
      && !document.querySelector("dialog[open], [role=dialog]")) {
      event.preventDefault();
      event.stopPropagation();
      if (direction === -1 ? linkHistory?.back : linkHistory?.forward) onLinkHistory(direction, capturePosition(), requestClose);
      return;
    }
    if (!readonly || !onNavigate || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !["ArrowLeft", "ArrowRight"].includes(event.key) || (event.target as Element).closest("input, textarea, select, dialog, [role=dialog]")) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === "ArrowLeft" ? previous : next) requestClose(() => onNavigate(event.key === "ArrowLeft" ? -1 : 1));
  }}>
    {!renderMarkdown && <DocumentTitleBar className="local-files-toolbar local-file-titlebar">{accessToggle}<DocumentTitleField title={file.node.name} modified={dirty} preview revealOnClick={false} readonly={readonly} info={titleInfo} />
      {markdown && <FileBrowserMarkdownMode rendered={renderMarkdown} disabled={!base} onChange={changePreviewMode} />}
      {markdown && base && !mobile && <DocumentPreviewControls state={split} />}
      <span ref={setNavigationTarget} className="workbench-navigation-actions" /><MoreToolsButton className="btn-icon" expanded={moreTools} onToggle={() => setMoreTools(!moreTools)} /><PanelSideToggle />
      {titleActions}
    </DocumentTitleBar>}
    {!renderMarkdown && diskNoticeSlot}
    {loading && <p role="status">正在读取文件…</p>}
    {!diskChanges && <DiskChangeNotice store={changeStore} active={active} activeId={changeId} target={diskNoticeTarget} />}
    {diskIssue && <div className="workbench-source-notice" role="status">{diskIssue}<button type="button" aria-label="关闭磁盘读取提示" onClick={() => setDiskIssue("")}>×</button></div>}
    {error && !base && <>{unsupported && <p>此文件暂时无法内置预览，可使用其它应用打开。</p>}<FileBrowserFileDetails rootId={file.rootId} node={file.node.id} provider={provider} /></>}
    {error && !unsupported && !leave && active && <WorkspaceDialog title="文件操作异常" onClose={() => setError("")}><p role="alert">{error}</p></WorkspaceDialog>}
    {linkCheck !== null && active && <MarkdownLinkCheckDialog key={renderMarkdown ? "rendered" : "source"} node={linkOrigin?.node ?? file.node.id} rootId={linkOrigin?.rootId ?? file.rootId}
      source={linkCheck} provider={provider} read={readLinkTarget} onClose={() => setLinkCheck(null)}
      onPrepareRepair={!readonly && editable && renderMarkdown ? () => changePreviewMode(false) : undefined}
      onRepair={!readonly && editable && !renderMarkdown ? edit => {
        if (current() !== linkCheck) throw new Error("文档已变化，请关闭后重新检查");
        const editor = handle.current;
        if (!editor || editor.value !== linkCheck || !edit.link.range) throw new Error("源码仍在同步，请稍后重试");
        const { from, to } = edit.link.range;
        const updated = applyMarkdownLinkEdits(linkCheck, [edit]);
        editor.insertIsolated(from, to, updated.slice(from, updated.length - (linkCheck.length - to)));
        setLinkCheck(null);
      } : undefined} />}
    {linkNotice && active && <WorkspaceDialog title="文档链接" onClose={() => setLinkNotice(undefined)}>
      <p role="alert">{linkNotice.message}</p>
      {linkNotice.offerStart && <button type="button" onClick={() => { setLinkNotice(undefined); goToFileStart(); }}>打开文件开头</button>}
    </WorkspaceDialog>}
    {notice && active && <WorkspaceDialog title="文件提示" onClose={() => setNotice("")}><p role="status">{notice}</p></WorkspaceDialog>}
    {candidate && <div role="status">发现此会话未保存草稿。<button type="button" onClick={() => { change(candidate.source); applyBase({ ...base!, source: candidate.baseSource, revision: candidate.baseRevision, bom: candidate.bom, lineEnding: candidate.lineEnding }); setCandidate(null); setReadonly(false); setSourceMounted(true); renderMode.current = false; setRenderMarkdown(false); }}>恢复草稿</button><button type="button" onClick={() => { void exportLocalSource(file.node.name, candidate.source, candidate, host.saveCopy).catch(cause => setError(String(cause))); }}>下载草稿</button><button type="button" onClick={() => { void host.drafts.remove(identity).then(() => setCandidate(null)).catch(cause => setError(String(cause))); }}>删除草稿</button></div>}
    {!loading && base && markdown && renderMounted && <div className="workbench-rendered-session" hidden={!renderMarkdown}>
      <DocumentImageLibraryContext.Provider value={false}>
        <Suspense fallback={<p role="status">正在加载 Markdown 编辑器…</p>}><MarkdownWorkspace key={renderEpoch} identity={`workbench:${identity}`} editorSessionId={renderedSession.current} onCreateDocument={onCreateDocument} createDocumentLabel="新建文件" onError={setError} modified={dirty} source={source} title={file.node.name} active={active && renderMarkdown} readonly={readonly || !editable || !renderMarkdown || !active} focusMode={false} fontSize={typography.note_font_size} vimModeEnabled={false} useCustomContextMenu={editorSettings.use_custom_context_menu} showStatusBlockNumber={editorSettings.editor_show_status_block_number} highlightActiveLine={editorSettings.highlight_active_line} showLineNumbers={editorSettings.editor_show_line_numbers} onEditorConfigChange={async patch => { setEditorSettings(saveWorkbenchEditorSettings(settings, readWorkbenchEditorSettings(settings), patch)); }} showStatusBar={editorSettings.editor_show_status_bar} defaultCodeBlockWrap cjkLatinSpacing={typography.editor_cjk_spacing} readonlyHeadingFoldInFocusMode={false}
          bookmarks={lineBookmarks.map(item => ({ id: item.id, offset: item.position, line: source.slice(0, item.position).split("\n").length, label: item.label || item.preview }))} onBookmarksChange={items => setLineBookmarks(items.map(item => ({ id: item.id, position: item.offset, label: item.label, preview: item.label })))} onSourceChange={renderedChange} onPending={() => setRenderPending(true)} onRegisterFlush={registerRenderedFlush} onEditorReady={bindRendered} separateTitle afterTitle={renderMarkdown ? diskNoticeSlot : null} titleRevealOnClick={false} onExportMarkdown={copy} onClick={() => {}} onOpenLink={href => void followLink(href)} canOpenLink={canFollowMarkdownLink} bindHeadingNavigation={bindHeadingNavigation} onReadonlyChange={editable ? setReadonly : undefined} resolveResource={resolveResource} saveStatus={saving ? "saving" : dirty ? "dirty" : "clean"}
          info={titleInfo} titleActions={titleActions} viewToggle={<FileBrowserMarkdownMode rendered onChange={changePreviewMode} />} />
        </Suspense>
      </DocumentImageLibraryContext.Provider>
    </div>}
    {!loading && base && sourceMounted && <div className="local-file-editor-shell workbench-source-session" style={{ "--editor-font-family": blockFontFamily(typography.source_font_family), "--editor-source-font-family": blockFontFamily(typography.source_font_family) } as React.CSSProperties} hidden={renderMarkdown}><DocumentNavigationWorkspace origin="local" active={active && !renderMarkdown} revision={sourceNavigation} bookmarkItems={lineBookmarks.map(item => ({ ...item, offset: item.position, blockNumber: source.slice(0, item.position).split("\n").length }))} sourceHandle={position.sourceHandle} onJump={offset => { handle.current?.setSelectionRange(offset, offset); handle.current?.scrollToOffset(offset, true); }} onToggleBookmark={offset => setLineBookmarks(items => items.some(item => item.position === offset) ? items.filter(item => item.position !== offset) : [...items, { id: crypto.randomUUID(), position: offset, label: "", preview: source.slice(offset, offset + 80) }])} onRemoveBookmark={id => setLineBookmarks(items => items.filter(item => item.id !== id))} onRenameBookmark={(id, label) => setLineBookmarks(items => items.map(item => item.id === id ? { ...item, label } : item))}>{controls => <>{navigationTarget && createPortal(controls, navigationTarget)}<DocumentActiveBoundary active={active && !renderMarkdown}><DocumentSourceSurface key={renderEpoch} editor={{ value: sourceProjection.current, readonly: readonly || Boolean(relocation) || renderMarkdown || !active, areaRef: handle, session, onChange: change, fontSize: typography.note_font_size, highlightActiveLine: editorSettings.highlight_active_line, showLineNumbers: editorSettings.editor_show_line_numbers, onEditorConfigChange: async patch => { setEditorSettings(saveWorkbenchEditorSettings(settings, readWorkbenchEditorSettings(settings), patch)); }, showStatusBar: editorSettings.editor_show_status_bar, contextMenuEnabled: editorSettings.use_custom_context_menu, onCreateDocument, createDocumentLabel: "新建文件", documentLanguage: language, documentLanguageValue: languageOverride ?? AUTO_DOCUMENT_LANGUAGE, documentLanguageOptions: documentLanguageViewOptions(detectedLanguage), onDocumentLanguageChange: value => {
        try { saveWorkbenchFileLanguage(settings, identity, value); setLanguageOverride(value === AUTO_DOCUMENT_LANGUAGE ? null : value); }
        catch (cause) { setError(String(cause)); }
      }, saveStatus: saving ? "saving" : dirty ? "dirty" : "clean", savedLabel: "保存到原文件；不参与数据库备份", navigation: null,
      onReady: bindHandle, onOpenLink: href => void followLink(href), canOpenLink: canFollowMarkdownLink,
    }} renderContent={editor => <DocumentImageLibraryContext.Provider value={false}><DocumentResourceContext.Provider value={resolveResource}>
      <MarkdownSplitPreview enabled={splitVisible} sync={split.sync} revision={sourceNavigation} sourceEditor={position.sourceHandle}
        fontSize={typography.note_font_size} highlightActiveLine={editorSettings.highlight_active_line} previewStyle={{ "--editor-font-family": blockFontFamily(typography.editor_font_family) } as React.CSSProperties}>
        {editor}
      </MarkdownSplitPreview>
    </DocumentResourceContext.Provider></DocumentImageLibraryContext.Provider>} /></DocumentActiveBoundary></>}</DocumentNavigationWorkspace></div>}
    {settingsOpen && active && <WorkbenchEditorSettingsDialog typography={typography} config={editorSettings} store={settings} onClose={() => setSettingsOpen(false)} />}
    {leave && <WorkspaceDialog title="未保存的文件编辑" onClose={cancelLeave}>{error && <p role="alert">{error}</p>}<p>{persistDocument ? "首次保存时选择文件位置；也可保留本机编辑文档，下次启动会恢复。删除本机编辑草稿需通过标签菜单明确确认。" : "请先保存到原文件，或确认恢复草稿已持久化后离开。导出副本不会将原文件标记为已保存。最多保留 5 份草稿，不自动淘汰；满额时须先处理旧草稿。"}</p><div>
      <button type="button" disabled={saving || !host.canSaveOriginal(file.rootId)} onClick={() => { void save().then(clean => { if (clean) { const target = leave; setLeave(null); if (target === "close") finishClose(); else void read(); } }); }}>保存后继续</button>
      <button type="button" disabled={saving} onClick={() => void keepAndLeave()}>保留草稿后继续</button><button type="button" onClick={cancelLeave}>取消</button>
    </div></WorkspaceDialog>}
  </section></EditorFoldIconContext.Provider>;
}
