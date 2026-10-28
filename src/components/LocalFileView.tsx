import { DocumentTitlePreview } from "./DocumentTitlePreview";
import { DocumentTitleBar, DocumentAccessToggle } from "./DocumentChrome";
import { DocumentNavigationWorkspace } from "./DocumentNavigationWorkspace";
import { sessionHeadingFoldStore } from "../lib/heading-fold";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { localFileService, resolveRelativeNode, type LocalFileSnapshot } from "../lib/local-files/service";
import { readLocalDraft, removeLocalDraft, writeLocalDraft } from "../lib/local-files/recovery";
import { localFileSessions, localFileSessionEpoch, registerLocalFileCheckpoint, registerLocalFileSaver, setLocalFileDirty } from "../lib/local-files/session";
import { readLocalFilePosition, saveLocalFilePosition } from "../lib/local-files/position";
import { isLocalFileReadOnly, LOCAL_FILE_ACCESS_CHANGED_EVENT, setLocalFileReadOnly } from "../lib/local-files/access";
import type { LocalFileViewData } from "../lib/plugin-system/main-view-registry";
import { AUTO_DOCUMENT_LANGUAGE, documentLanguageFromFilename, documentLanguageViewOptions, saveSourceViewLanguageOverride, sourceViewLanguageOverride } from "../lib/document-language";
import type { SourceEditorHandle } from "../lib/source-editor-handle";
import type { AppConfig } from "../types/models";
import { DocumentSourceSurface } from "./DocumentSourceSurface";
import { ToolbarIcon } from "./ToolbarIcon";
import { TextDiffView } from "./TextDiffView";
import { parseFlowDocument } from "./FlowBlockContent";
import { SourceDocumentPreview } from "./SourceDocumentPreview";
import { MARKDOWN_READING_NAVIGATE_EVENT, MarkdownReadingView, type MarkdownReadingSession } from "./MarkdownReadingView";
import { LOCAL_FILE_VIEW_ID } from "../lib/plugin-system/builtin-local-files";
import { mainViews } from "../lib/plugin-system/main-view-registry";
import { workspacePanels } from "../lib/plugin-system/panel-registry";
import { useFocusEditorTools } from "../stores/useFocusEditorTools";
import { useNativeMenuActions } from "../hooks/useNativeMenuActions";
import { SourceNavigationDocument } from "../lib/markdown-source-navigation";
import { shortcutTitle } from "../lib/editor-shortcuts";
import "../styles/local-files.css";

type LocalBookmark = { offset: number; line: number; label: string };
function bookmarkStorageKey(identity: string) { return `nr:local-file-bookmarks:${identity}`; }
function symbolFoldsStorageKey(identity: string) { return `nr:local-file-symbol-folds:${identity}`; }
function localFilePosition(handle: SourceEditorHandle) {
  const view = handle.view, scrollTop = view.scrollDOM.scrollTop;
  const block = view.lineBlockAtHeight(scrollTop);
  return { offset: handle.selectionStart, scrollTop, scrollLeft: view.scrollDOM.scrollLeft, anchor: block.from, topOffset: block.top - scrollTop };
}
function loadBookmarks(identity: string): LocalBookmark[] {
  try {
    const value = JSON.parse(localStorage.getItem(bookmarkStorageKey(identity)) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is LocalBookmark => typeof item?.offset === "number" && typeof item?.line === "number" && typeof item?.label === "string") : [];
  } catch { return []; }
}
function loadSymbolFolds(identity: string) {
  try {
    const value = JSON.parse(localStorage.getItem(symbolFoldsStorageKey(identity)) ?? "[]");
    return new Set<string>(Array.isArray(value) ? value.filter(item => typeof item === "string") : []);
  } catch { return new Set<string>(); }
}

export function LocalFileView({ data, onClose, fontSize, highlightActiveLine, showLineNumbers, showStatusBar, onEditorConfigChange, active, focusMode, readonlyHeadingFoldInFocusMode = true, defaultCodeBlockWrap = true, cjkLatinSpacing = true }: {
  data: Readonly<LocalFileViewData>;
  onClose: () => void;
  fontSize: number;
  highlightActiveLine: boolean;
  showLineNumbers: boolean;
  showStatusBar: boolean;
  onEditorConfigChange?: (patch: Partial<AppConfig>) => Promise<void>;
  active: boolean;
  focusMode: boolean;
  readonlyHeadingFoldInFocusMode?: boolean;
  defaultCodeBlockWrap?: boolean;
  cjkLatinSpacing?: boolean;
}) {
  const moreToolsPreference = useFocusEditorTools(state => state.expanded);
  const setMoreTools = useFocusEditorTools(state => state.setExpanded);
  const moreTools = moreToolsPreference ?? !focusMode;
  useNativeMenuActions({
    "view.tools": { run: () => setMoreTools(!moreTools), checked: moreTools },
  }, active);
  const identity = `${data.rootId}:${data.nodeId}`;
  const editorSession = useRef<EditorState | null>(null);
  const sourceHandle = useRef<SourceEditorHandle | null>(null);
  const localViewRef = useRef<HTMLElement>(null);
  const sourceRef = useRef("");
  const sessionEpochRef = useRef(localFileSessionEpoch);
  const [editorHandle, setEditorHandle] = useState<SourceEditorHandle | null>(null);
  const restoredScroll = useRef(false);
  const restoringPosition = useRef(false);
  const restorePositionCleanup = useRef<(() => void) | null>(null);
  const appliedSearchLocation = useRef<LocalFileViewData["location"]>();
  const searchLocation = useRef(data.location);
  searchLocation.current = data.location;
  const positionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deepFileCheckAt = useRef(0);
  const [source, setSource] = useState("");
  const [baseSnapshot, setBaseSnapshot] = useState<LocalFileSnapshot | null>(null);
  const [externalSnapshot, setExternalSnapshot] = useState<LocalFileSnapshot | null>(null);
  const [readOnly, setReadOnly] = useState(() => isLocalFileReadOnly(data.rootId, data.nodeId));
  const editing = !readOnly;
  const [preview, setPreview] = useState(false);
  const readingSession = useMemo<MarkdownReadingSession>(() => ({ identity, source, scrollTop: 0, states: new Map(), foldedHeadings: new Set(sessionHeadingFoldStore.load(`local-file:${identity}`)?.collapsedKeys ?? []) }), [identity, source]);
  const [saveState, setSaveState] = useState<"clean" | "dirty" | "saving" | "saved" | "error">("clean");
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const [previewSource, setPreviewSource] = useState("");
  const [previewError, setPreviewError] = useState("");
  const latestDraft = useRef<{ source: string; base: LocalFileSnapshot | null }>({ source: "", base: null });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [foldedSymbols, setFoldedSymbols] = useState<Set<string>>(() => loadSymbolFolds(identity));
  const [activeOffset, setActiveOffset] = useState(0);
  const [bookmarks, setBookmarks] = useState<LocalBookmark[]>(() => loadBookmarks(identity));
  const [reload, setReload] = useState(0);
  const detectedLanguage = documentLanguageFromFilename(data.name, source);
  const languageOverrideIdentity = `local-file:${identity}`;
  const [languageOverride, setLanguageOverride] = useState<string | null>(() => sourceViewLanguageOverride(languageOverrideIdentity));
  const language = languageOverride ?? detectedLanguage;
  latestDraft.current = { source, base: baseSnapshot };
  const saveBusy = useRef(false);
  const savingOperation = useRef(false);
  saveBusy.current = saveState === "saving";
  useEffect(() => registerLocalFileCheckpoint(identity, async () => {
    const handle = sourceHandle.current;
    if (handle && !restoringPosition.current && handle.view.scrollDOM.clientHeight > 0) {
      saveLocalFilePosition(identity, localFilePosition(handle));
      localFileSessions.set(identity, { state: handle.view.state, scrollTop: handle.view.scrollDOM.scrollTop, scrollLeft: handle.view.scrollDOM.scrollLeft, source: handle.value, scrollSnapshot: handle.view.scrollSnapshot() });
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      if (saveBusy.current) throw new Error("文件正在保存，请等待保存完成后关闭。");
      const current = latestDraft.current;
      const text = sourceHandle.current?.value ?? current.source;
      if (!current.base) return;
      if (text === current.base.source) { await removeLocalDraft(identity); return; }
      await writeLocalDraft({ identity, source: text, baseSource: current.base.source, baseRevision: current.base.revision, bom: current.base.bom, lineEnding: current.base.lineEnding, savedAt: Date.now() });
      if (!saveBusy.current && (sourceHandle.current?.value ?? latestDraft.current.source) === text && latestDraft.current.base === current.base) return;
    }
    throw new Error("文件在关闭准备期间持续变化，请停止输入后重试。");
  }), [identity]);
  useEffect(() => {
    setLocalFileDirty(identity, Boolean(baseSnapshot && source !== baseSnapshot.source) || saveState === "saving");
    return () => setLocalFileDirty(identity, false);
  }, [identity, saveState, baseSnapshot, source]);

  useEffect(() => {
    const sync = (event: Event) => {
      const changed = (event as CustomEvent<{ rootId?: string; nodeId?: string }>).detail;
      if (changed?.rootId !== data.rootId) return;
      const changedNode = changed.nodeId ?? "";
      const prefix = changedNode ? `${changedNode}/` : "";
      if (data.nodeId === changedNode || data.nodeId.startsWith(prefix) || changedNode.startsWith(`${data.nodeId}/`)) {
        const next = isLocalFileReadOnly(data.rootId, data.nodeId);
        setReadOnly(next);
        if (next && sourceRef.current !== baseSnapshot?.source)
          setRecoveryNotice("此路径已设为只读；未保存的编辑仍保留在本机草稿中。取消只读后可继续保存。");
      }
    };
    window.addEventListener(LOCAL_FILE_ACCESS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(LOCAL_FILE_ACCESS_CHANGED_EVENT, sync);
  }, [baseSnapshot?.source, data.nodeId, data.rootId]);

  useEffect(() => {
    setBookmarks(loadBookmarks(identity));
    setActiveOffset(0);
    setFoldedSymbols(loadSymbolFolds(identity));
    setLanguageOverride(sourceViewLanguageOverride(languageOverrideIdentity));
  }, [identity, languageOverrideIdentity]);
  useEffect(() => { localStorage.setItem(bookmarkStorageKey(identity), JSON.stringify(bookmarks)); }, [bookmarks, identity]);
  useEffect(() => { localStorage.setItem(symbolFoldsStorageKey(identity), JSON.stringify([...foldedSymbols])); }, [foldedSymbols, identity]);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const cached = localFileSessions.get(identity);
    setLoading(true); setError(""); setBaseSnapshot(null); setExternalSnapshot(null); restoredScroll.current = false; deepFileCheckAt.current = 0;
    void localFileService.readSnapshot(data.rootId, data.nodeId).then(async snapshot => {
      if (disposed) return;
      const draft = await readLocalDraft(identity).catch(() => null);
      if (disposed) return;
      const recovered = draft?.source !== undefined;
      const shown = draft?.source ?? snapshot.source;
      editorSession.current = cached?.source === shown ? cached.state : null;
      sourceRef.current = shown;
      setBaseSnapshot(draft && draft.source !== snapshot.source && draft.baseRevision !== snapshot.revision
        ? { ...snapshot, source: draft.baseSource, revision: draft.baseRevision, bom: draft.bom, lineEnding: draft.lineEnding }
        : snapshot);
      setSource(shown);
      setSaveState(shown === snapshot.source ? "clean" : "dirty");
      if (recovered) {
        if (draft.source === snapshot.source) {
          setRecoveryNotice("恢复草稿与磁盘内容一致，文件已保存。");
          void removeLocalDraft(identity).catch(() => {});
        } else {
          setRecoveryNotice(draft.baseRevision === snapshot.revision ? "已恢复未保存的本机编辑草稿。" : "发现上次未保存草稿，磁盘文件已变化；请比较后决定保留哪一份。");
          if (draft.baseRevision !== snapshot.revision) setExternalSnapshot(snapshot);
        }
      }
      setLoading(false);
    }).catch(reason => { if (!disposed) { setError(String(reason)); setLoading(false); } });
    return () => { disposed = true; controller.abort(); };
  }, [data.rootId, data.nodeId, identity, language, reload]);
  useEffect(() => {
    if (!baseSnapshot || source === baseSnapshot.source) { setSaveState(current => current === "saving" || current === "saved" ? current : "clean"); return; }
    setSaveState(current => current === "saving" ? current : "dirty");
    const timer = window.setTimeout(() => {
      void writeLocalDraft({ identity, source, baseSource: baseSnapshot.source, baseRevision: baseSnapshot.revision, bom: baseSnapshot.bom, lineEnding: baseSnapshot.lineEnding, savedAt: Date.now() }).then(() => setRecoveryNotice("未保存编辑已暂存到本机。"), () => setRecoveryNotice("本机恢复草稿暂存失败；请尽快保存文件。"));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [baseSnapshot, identity, source]);
  useEffect(() => () => {
    const current = latestDraft.current;
    if (current.base && current.source !== current.base.source) {
      void writeLocalDraft({ identity, source: current.source, baseSource: current.base.source, baseRevision: current.base.revision, bom: current.base.bom, lineEnding: current.base.lineEnding, savedAt: Date.now() }).catch(() => {});
    }
  }, [identity]);
  useEffect(() => {
    const location = data.location;
    if (!location || appliedSearchLocation.current === location || loading || !baseSnapshot || !editorHandle || preview) return;
    if (location.revision !== baseSnapshot.revision || sourceRef.current !== baseSnapshot.source) {
      setRecoveryNotice("文件在搜索后已变化或存在未保存编辑，未按旧位置跳转；请保存后重新搜索。");
      appliedSearchLocation.current = location;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (sourceHandle.current !== editorHandle) return;
      appliedSearchLocation.current = location;
      const from = Math.min(location.from, editorHandle.value.length), to = Math.min(location.to, editorHandle.value.length);
      editorHandle.setSelectionRange(from, to); editorHandle.scrollToOffset(from, true); setActiveOffset(from);
    });
    return () => cancelAnimationFrame(frame);
  }, [data.location, loading, baseSnapshot, editorHandle, preview]);
  useEffect(() => { if (data.location) setPreview(false); }, [data.location]);
  useEffect(() => {
    if (!baseSnapshot) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void localFileService.stat(data.rootId, data.nodeId).then(fingerprint => {
        const now = Date.now();
        const changed = fingerprint.size !== baseSnapshot.size || fingerprint.modifiedMs !== baseSnapshot.modifiedMs;
        if (!changed && now - deepFileCheckAt.current < 15_000) return null;
        deepFileCheckAt.current = now;
        return localFileService.readSnapshot(data.rootId, data.nodeId);
      }).then(next => {
        if (!next || next.revision === baseSnapshot.revision) return;
        if (sourceRef.current === baseSnapshot.source) {
          setBaseSnapshot(next); setSource(next.source); sourceRef.current = next.source; editorSession.current = null; setExternalSnapshot(null); setSaveState("clean");
          setRecoveryNotice("检测到磁盘文件变化，已重新载入并保留阅读位置。");
        } else setExternalSnapshot(next);
      }).catch(reason => setRecoveryNotice(`本地文件不可访问：${String(reason)}`));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [baseSnapshot, data.rootId, data.nodeId]);
  const bindHandle = useCallback((handle: SourceEditorHandle | null) => {
    const previous = sourceHandle.current;
    if (!handle && previous && !restoringPosition.current && sessionEpochRef.current === localFileSessionEpoch) {
      const visible = previous.view.scrollDOM.clientHeight > 0;
      const position = visible ? localFilePosition(previous) : readLocalFilePosition(identity);
      const saved = localFileSessions.get(identity);
      if (visible && position) saveLocalFilePosition(identity, position);
      localFileSessions.delete(identity);
      localFileSessions.set(identity, { state: previous.view.state, source: sourceRef.current, scrollTop: position?.scrollTop ?? saved?.scrollTop ?? 0, scrollLeft: position?.scrollLeft ?? saved?.scrollLeft ?? 0, scrollSnapshot: visible ? previous.view.scrollSnapshot() : saved?.source === sourceRef.current ? saved.scrollSnapshot : undefined });
      while (localFileSessions.size > 3) localFileSessions.delete(localFileSessions.keys().next().value!);
    }
    sourceHandle.current = handle;
    setEditorHandle(handle);
    if (!handle) {
      restorePositionCleanup.current?.(); restorePositionCleanup.current = null;
      restoredScroll.current = false; restoringPosition.current = false; return;
    }
    const requested = searchLocation.current, base = latestDraft.current.base;
    if (requested && requested !== appliedSearchLocation.current && requested.revision === base?.revision && sourceRef.current === base.source) return;
    const cached = localFileSessions.get(identity);
    if (restoredScroll.current) return;
    const position = readLocalFilePosition(identity);
    const memory = cached?.source === sourceRef.current ? cached : null;
    if (!memory && !position) return;
    restoredScroll.current = true; restoringPosition.current = true;
    const view = handle.view;
    let cancelled = false;
    const detach = () => {
      view.dom.removeEventListener("wheel", cancel, true);
      view.dom.removeEventListener("pointerdown", cancel, true);
      view.dom.removeEventListener("keydown", cancel, true);
    };
    const cancel = () => { cancelled = true; restoringPosition.current = false; detach(); };
    restorePositionCleanup.current = () => { cancelled = true; detach(); };
    view.dom.addEventListener("wheel", cancel, { capture: true, passive: true });
    view.dom.addEventListener("pointerdown", cancel, true);
    view.dom.addEventListener("keydown", cancel, true);
    const current = () => !cancelled && sourceHandle.current === handle && handle.view === view && view.dom.isConnected;
    if (memory?.scrollSnapshot) view.dispatch({ effects: memory.scrollSnapshot });
    else if (position) {
      const offset = Math.max(0, Math.min(view.state.doc.length, position.offset));
      const anchor = Number.isSafeInteger(position.anchor) ? Math.max(0, Math.min(view.state.doc.length, position.anchor!)) : null;
      view.dispatch({ selection: { anchor: offset }, ...(anchor !== null ? { effects: EditorView.scrollIntoView(anchor, { y: "start", yMargin: Number.isFinite(position.topOffset) ? position.topOffset : 0 }) } : {}) });
    }
    // Let the initial reveal finish before applying the within-line offset.
    // CodeMirror processes scroll targets after measurement writes.
    view.requestMeasure({ read: () => null, write: () => queueMicrotask(() => {
      if (!current()) return;
      view.requestMeasure({
        read: () => position?.anchor !== undefined && Number.isSafeInteger(position.anchor) && Number.isFinite(position.topOffset)
          ? view.lineBlockAt(Math.max(0, Math.min(view.state.doc.length, position.anchor))).top - position.topOffset!
          : memory?.scrollTop ?? position?.scrollTop ?? 0,
        write: top => {
          if (!current()) return;
          if (!memory?.scrollSnapshot) {
            view.scrollDOM.scrollTop = top;
            view.scrollDOM.scrollLeft = memory?.scrollLeft ?? position?.scrollLeft ?? 0;
            view.dispatch({ effects: view.scrollSnapshot() });
          }
          detach(); restorePositionCleanup.current = null;
          restoringPosition.current = false;
        },
      });
    }) });
  }, [identity]);
  useEffect(() => {
    if (!editorHandle) return;
    const persistPosition = () => {
      // Passive effect cleanup can run after CodeMirror has removed its scroller.
      if (!editorHandle.view.dom.isConnected || !editorHandle.view.scrollDOM.clientHeight || restoringPosition.current || sessionEpochRef.current !== localFileSessionEpoch) return;
      saveLocalFilePosition(identity, localFilePosition(editorHandle));
    };
    const schedulePositionSave = () => {
      if (positionSaveTimer.current !== null) clearTimeout(positionSaveTimer.current);
      positionSaveTimer.current = setTimeout(persistPosition, 180);
    };
    const sync = () => { setActiveOffset(editorHandle.selectionStart); schedulePositionSave(); };
    sync();
    editorHandle.addEventListener("select", sync);
    editorHandle.addEventListener("keyup", sync);
    editorHandle.addEventListener("click", sync);
    editorHandle.view.scrollDOM.addEventListener("scroll", schedulePositionSave, { passive: true });
    window.addEventListener("pagehide", persistPosition);
    return () => {
      if (positionSaveTimer.current !== null) clearTimeout(positionSaveTimer.current);
      persistPosition();
      editorHandle.removeEventListener("select", sync);
      editorHandle.removeEventListener("keyup", sync);
      editorHandle.removeEventListener("click", sync);
          editorHandle.view.scrollDOM.removeEventListener("scroll", schedulePositionSave);
      window.removeEventListener("pagehide", persistPosition);
    };
  }, [editorHandle, identity]);

  const jump = (offset: number) => {
    const handle = sourceHandle.current;
    if (preview) {
      const position = renderedNavigation.blockAt(offset)?.position ?? 0;
      localViewRef.current?.querySelector(".markdown-reading-view")?.dispatchEvent(new CustomEvent(MARKDOWN_READING_NAVIGATE_EVENT, { detail: { position } }));
      return;
    }
    if (!handle) return;
    const at = Math.max(0, Math.min(handle.value.length, offset));
    handle.setSelectionRange(at, at); handle.scrollToOffset(at, true); setActiveOffset(at); handle.focus();
  };
  const save = useCallback(async (overwriteExternal = false) => {
    if (savingOperation.current) return false;
    if (isLocalFileReadOnly(data.rootId, data.nodeId)) {
      setError("此本地文件当前为只读。请先在文件树右键菜单中切换为可编辑。");
      return false;
    }
    if (!editing && !overwriteExternal) return;
    const base = overwriteExternal && externalSnapshot ? externalSnapshot : baseSnapshot;
    if (!base) return;
    savingOperation.current = true;
    setSaveState("saving"); setError("");
    try {
      const savingSource = sourceHandle.current?.value ?? sourceRef.current;
      const saved = await localFileService.write(data.rootId, data.nodeId, savingSource, base);
      setBaseSnapshot(saved); setExternalSnapshot(null);
      const currentSource = sourceRef.current;
      if (currentSource === savingSource) {
        setSaveState("saved"); setRecoveryNotice("文件已保存到磁盘。");
        await removeLocalDraft(identity).catch(() => {});
      } else {
        setSaveState("dirty"); setRecoveryNotice("已保存提交时的内容；之后的编辑仍未保存。");
        void writeLocalDraft({ identity, source: currentSource, baseSource: saved.source, baseRevision: saved.revision, bom: saved.bom, lineEnding: saved.lineEnding, savedAt: Date.now() }).catch(() => {});
      }
      window.setTimeout(() => setSaveState(current => current === "saved" ? "clean" : current), 1800);
      return true;
    } catch (reason) {
      const message = String(reason);
      setSaveState("error"); setError(message.includes("STALE_REVISION") ? "磁盘文件已变化，请在下方比较后选择重载或覆盖。" : message);
      if (message.includes("STALE_REVISION")) {
        const latest = await localFileService.readSnapshot(data.rootId, data.nodeId).catch(() => null);
        if (latest) { setExternalSnapshot(latest); setError(""); }
      }
      return false;
    } finally {
      savingOperation.current = false;
    }
  }, [baseSnapshot, data.nodeId, data.rootId, editing, externalSnapshot, identity]);
  useEffect(() => registerLocalFileSaver(identity, async () => {
    if (saveBusy.current) throw new Error("文件正在保存，请稍后重试");
    return (await save()) === true;
  }), [identity, save]);
  const saveCopy = async () => {
    try {
      const result = await localFileService.saveAs(data.name, source, baseSnapshot);
      if (result === "saved") { setRecoveryNotice("已另存为副本；原文件未改变。"); return; }
      if (result === "cancelled") return;
    } catch (reason) { setError(`另存为失败：${String(reason)}`); return; }
    const normalized = source.replace(/\r\n?/g, "\n");
    const eol = baseSnapshot?.lineEnding === "crlf" ? normalized.replace(/\n/g, "\r\n") : baseSnapshot?.lineEnding === "cr" ? normalized.replace(/\n/g, "\r") : normalized;
    const copy = (baseSnapshot?.bom ? "\ufeff" : "") + eol;
    if (new TextEncoder().encode(copy).length > 4 * 1024 * 1024) { setError("另存后文件超过 4 MiB"); return; }
    const blob = new Blob([copy], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = data.name; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setRecoveryNotice("已下载当前内容副本；原文件未改变。");
  };
  useEffect(() => {
    const view = editorHandle?.view;
    if (!view) return;
    const handler = (event: KeyboardEvent) => {
      if (editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
    };
    view.dom.addEventListener("keydown", handler);
    return () => view.dom.removeEventListener("keydown", handler);
  }, [editorHandle, editing, save]);
  const isMarkdown = language === "markdown";
  const isMermaid = language === "mermaid";
  const isFlow = language === "flow";
  useEffect(() => { if (!isMarkdown && !isMermaid && !isFlow) setPreview(false); }, [isMarkdown, isMermaid, isFlow]);
  useEffect(() => {
    if (!preview || !isMarkdown) { setPreviewSource(source); setPreviewError(""); return; }
    let cancelled = false;
    const imagePattern = /!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g;
    const replacements: Array<{ before: string; after: string }> = [];
    void (async () => {
      for (const match of source.matchAll(imagePattern)) {
        const href = match[2] ?? match[3] ?? "";
        if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(href)) continue;
        try {
          const node = resolveRelativeNode(data.nodeId, href);
          const uri = await localFileService.readImageAsset(data.rootId, node);
          replacements.push({ before: match[0], after: match[0].replace(href, uri) });
        } catch { /* leave unavailable or out-of-root images as normal broken references */ }
      }
      if (cancelled) return;
      let result = source;
      for (const replacement of replacements) result = result.replace(replacement.before, replacement.after);
      setPreviewSource(result); setPreviewError("");
    })().catch(error => { if (!cancelled) { setPreviewSource(source); setPreviewError(String(error)); } });
    return () => { cancelled = true; };
  }, [data.nodeId, data.rootId, isMarkdown, preview, source]);
  const markdownDoc = useMemo(() => {
    if (!preview || !isMarkdown) return null;
    try { return parseFlowDocument(previewSource); } catch { return null; }
  }, [isMarkdown, preview, previewSource]);
  const renderedNavigation = useMemo(() => new SourceNavigationDocument(source, [], undefined), [source]);
  const navigationRevision = useMemo(() => new SourceNavigationDocument(source, [], { sourceLanguage: language }), [source, language]);
  const navigationBookmarks = useMemo(() => bookmarks.map(bookmark => ({ id: String(bookmark.offset), position: bookmark.offset, offset: bookmark.offset, blockNumber: bookmark.line, label: bookmark.label, preview: bookmark.label })), [bookmarks]);
  const scrollLocalDocumentTo = (target: "top" | "middle" | "bottom") => {
    const scroller = preview ? localViewRef.current?.querySelector<HTMLElement>(".local-file-preview") : sourceHandle.current?.view.scrollDOM;
    if (!scroller) return;
    const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTo({ top: target === "top" ? 0 : target === "middle" ? maximum / 2 : maximum, behavior: "auto" });
  };
  const openRelative = (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || !event.currentTarget.contains(anchor)) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!href || href.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(href)) return;
    event.preventDefault();
    try {
      const nodeId = resolveRelativeNode(data.nodeId, href);
      const pathParts = nodeId.split("/"); const name = pathParts[pathParts.length - 1] ?? nodeId;
      mainViews.bind(workspacePanels.assert("files")).open(LOCAL_FILE_VIEW_ID, { rootId: data.rootId, nodeId, name });
    } catch (reason) { setPreviewError(String(reason)); }
  };
  const toggleBookmark = (offset?: number) => {
    const at = Math.max(0, Math.min(source.length, offset ?? sourceHandle.current?.selectionStart ?? activeOffset));
    const from = at > 0 ? source.lastIndexOf("\n", at - 1) + 1 : 0;
    const number = source.slice(0, from).split("\n").length;
    const end = source.indexOf("\n", from);
    const text = source.slice(from, end === -1 ? source.length : end);
    setBookmarks(current => {
      const existing = current.find(item => item.line === number);
      if (existing) return current.filter(item => item !== existing);
      return [...current, { offset: from, line: number, label: text.trim() || `第 ${number} 行` }].sort((left, right) => left.offset - right.offset);
    });
  };
  return <section ref={localViewRef} className="local-file-view" aria-label="本地文件工作区" data-tools-hidden={!moreTools || undefined}>
    <DocumentNavigationWorkspace key={identity} origin="local" active={active && !loading && !error} className="local-file-workspace"
      revision={navigationRevision} sourceHandle={preview ? null : editorHandle} currentOffset={activeOffset} bookmarkItems={navigationBookmarks}
      symbolFoldIds={foldedSymbols} onSymbolFoldIdsChange={setFoldedSymbols} onScrollDocument={scrollLocalDocumentTo}
      onJump={jump} onToggleBookmark={toggleBookmark}
      onRemoveBookmark={id => setBookmarks(current => current.filter(item => String(item.offset) !== id))}
      onRenameBookmark={(id, label) => setBookmarks(current => current.map(item => String(item.offset) === id ? { ...item, label: label.trim() || source.split("\n")[item.line - 1]?.trim() || `第 ${item.line} 行` } : item))}>
      {(controls, navigation) => <>
    <DocumentTitleBar className="local-files-toolbar local-file-titlebar"><DocumentAccessToggle readonly={readOnly} title={editing ? "设为只读" : "允许编辑"} aria-label={editing ? "设为只读" : "允许编辑"} onClick={() => setLocalFileReadOnly(data.rootId, data.nodeId, !readOnly)} /><div className="note-title-field" title={data.nodeId}><DocumentTitlePreview title={data.name} /></div><span>{saveState === "saving" ? "正在保存…" : saveState === "dirty" ? "未保存" : saveState === "saved" ? "已保存" : "本地文件 · 不参与备份"}</span>
      {editing && <button type="button" className="btn-icon" title={localFileService.canSaveOriginal(data.rootId) ? "保存到原文件（⌘S / Ctrl+S）" : "目录快照不能覆盖原文件，请另存为"} aria-label="保存文件" disabled={!baseSnapshot || !localFileService.canSaveOriginal(data.rootId) || saveState === "saving" || source === baseSnapshot.source} onClick={() => void save()}><ToolbarIcon name="save" /></button>}
      <button type="button" className="btn-icon" title="另存为副本" aria-label="另存为副本" onClick={saveCopy}><ToolbarIcon name="download" /></button>
      {(isMarkdown || isMermaid || isFlow) && <button type="button" className="btn-icon" title={preview ? "切换到源码模式" : "切换到渲染模式（编辑请使用源码）"} aria-label={preview ? "显示源码" : "渲染"} aria-pressed={preview} onClick={() => setPreview(value => !value)}><ToolbarIcon name={preview ? "code" : "eye"} /></button>}
      {(!preview || isMarkdown) && <button type="button" className="btn-icon" title={shortcutTitle("view.tools", "更多工具")} aria-label="更多工具" aria-expanded={moreTools} onClick={() => setMoreTools(!moreTools)}><ToolbarIcon name="annotate" /></button>}
      {controls}
      <button type="button" className="btn-icon" title="重新读取原文件" aria-label="重新读取原文件" disabled={loading} onClick={() => { editorSession.current = null; setReload(value => value + 1); }}><ToolbarIcon name="refresh" /></button>
      <button type="button" className="btn-icon" title="返回原视图" aria-label="返回原视图" onClick={onClose}><ToolbarIcon name="chevronLeft" /></button>
    </DocumentTitleBar>
    {recoveryNotice && <p role="status" className="local-files-message">{recoveryNotice}<button type="button" onClick={() => setRecoveryNotice("")} aria-label="关闭提示">×</button></p>}
    {loading && <p role="status" className="local-files-message">正在读取文件…</p>}
    {error && <p role="alert" className="local-files-message">{error}</p>}
    {externalSnapshot && <section className="local-file-conflict" aria-label="文件冲突处理"><strong>磁盘文件已发生变化</strong><p>当前编辑和磁盘版本均已保留。比较后选择重载，或明确覆盖磁盘版本。</p>
      <TextDiffView left={externalSnapshot.source} right={source} leftLabel="磁盘版本" rightLabel="本机编辑" />
      <div><button type="button" onClick={() => { setBaseSnapshot(externalSnapshot); setSource(externalSnapshot.source); sourceRef.current = externalSnapshot.source; setExternalSnapshot(null); setSaveState("clean"); void removeLocalDraft(identity); }}>重载磁盘版本</button><button type="button" disabled={!editing || saveState === "saving"} onClick={() => void save(true)}>确认覆盖磁盘</button><button type="button" onClick={saveCopy}>另存为副本</button></div>
    </section>}
    {!loading && !error && <>
      <div className="local-file-editor-shell" data-workspace-panel-start>{preview ? isMarkdown && markdownDoc ? <MarkdownReadingView doc={markdownDoc} source={source} session={readingSession} fontSize={fontSize} highlightActiveLine={highlightActiveLine} showLineNumbers={showLineNumbers} active={active} toolsVisible={moreTools} showStatusBar={showStatusBar} focusMode={focusMode} saveStatus={saveState} defaultCodeBlockWrap={defaultCodeBlockWrap} cjkLatinSpacing={cjkLatinSpacing} onOpenBookmarks={navigation.openBookmarks} bookmarks={bookmarks.map(bookmark => renderedNavigation.blockAt(bookmark.offset)?.position ?? 0)} onToggleBookmark={position => toggleBookmark(renderedNavigation.offsetAt(position + 1))} doubleClickFold={focusMode && readOnly && readonlyHeadingFoldInFocusMode} className="local-file-preview" onActivePosition={position => setActiveOffset(renderedNavigation.offsetAt(position + 1))} onClick={openRelative} /> : isMermaid || isFlow ? <SourceDocumentPreview language={language} source={source} fontSize={fontSize} className="local-file-preview" /> : <div className="editor-content local-file-preview"><p role="alert">{previewError || "暂时无法渲染，源码已保留，可切回源码模式。"}</p><pre>{source}</pre></div> : <DocumentSourceSurface editor={{
        value: source, readonly: !editing, contextMenuEnabled: true, onToggleLineBookmark: toggleBookmark,
        areaRef: sourceHandle, onReady: bindHandle, session: editorSession,
        onChange: next => { sourceRef.current = next; setSource(next); },
        fontSize, highlightActiveLine, showLineNumbers, showStatusBar, focusMode, saveStatus: saveState,
        documentLanguage: language, documentLanguageValue: languageOverride ?? AUTO_DOCUMENT_LANGUAGE,
        documentLanguageOptions: documentLanguageViewOptions(detectedLanguage),
        onDocumentLanguageChange: next => { const override = next === AUTO_DOCUMENT_LANGUAGE ? null : next; saveSourceViewLanguageOverride(languageOverrideIdentity, override); setLanguageOverride(override); },
        onEditorConfigChange,
      }} />}</div>
    </>}
    </>}
    </DocumentNavigationWorkspace>
  </section>;
}
