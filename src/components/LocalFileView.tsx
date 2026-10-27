import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { localFileService, resolveRelativeNode, type LocalFileSnapshot } from "../lib/local-files/service";
import { readLocalDraft, removeLocalDraft, writeLocalDraft } from "../lib/local-files/recovery";
import { localFileSessions, localFileSessionEpoch, registerLocalFileCheckpoint, registerLocalFileSaver, setLocalFileDirty } from "../lib/local-files/session";
import { readLocalFilePosition, saveLocalFilePosition } from "../lib/local-files/position";
import { isLocalFileReadOnly, LOCAL_FILE_ACCESS_CHANGED_EVENT, setLocalFileReadOnly } from "../lib/local-files/access";
import type { LocalFileViewData } from "../lib/plugin-system/main-view-registry";
import { AUTO_DOCUMENT_LANGUAGE, documentLanguageFromFilename, documentLanguageViewOptions, saveSourceViewLanguageOverride, sourceViewLanguageOverride } from "../lib/document-language";
import { extractSourceSymbols } from "../lib/source-symbol-provider";
import type { SourceSymbol } from "../lib/source-symbols";
import { extractDocumentOutline, type DocumentOutlineItem } from "../lib/document-outline";
import type { SourceEditorHandle } from "../lib/source-editor-handle";
import { focusSourceWordMatch, groupSourceWordMatchesByLine, sourceWordState } from "../lib/source-word-occurrences";
import { filterSymbolTree, sortSourceSymbolTree, sourceSymbolSortName } from "../lib/source-symbol-sort";
import type { AppConfig } from "../types/models";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";
import { DocumentOutlineList, OutlineDisplayTools, OUTLINE_SCROLL_EVENT, type VisibleOutlineEntry } from "./DocumentOutlineList";
import { ToolbarIcon } from "./ToolbarIcon";
import { TextDiffView } from "./TextDiffView";
import { FlowBlockContent, parseFlowDocument } from "./FlowBlockContent";
import { DeferredMermaidDiagram } from "./DeferredMermaidDiagram";
import { renderReadonlyBlock } from "./ReadonlyVirtualNote";
import type { ReadingBlockState } from "../lib/reading-block-session";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { LOCAL_FILE_VIEW_ID } from "../lib/plugin-system/builtin-local-files";
import { mainViews } from "../lib/plugin-system/main-view-registry";
import { workspacePanels } from "../lib/plugin-system/panel-registry";
import { copyToClipboard } from "../lib/clipboard";
import { NotesContextMenu, type NotesMenuTarget } from "./NotesContextMenu";
import { useFocusEditorTools } from "../stores/useFocusEditorTools";
import { useNativeMenuActions } from "../hooks/useNativeMenuActions";
import { shortcutTitle } from "../lib/editor-shortcuts";
import "../styles/local-files.css";

type LocalPanel = "symbols" | "bookmarks" | "matches" | "outline";
type LocalBookmark = { offset: number; line: number; label: string };
const PANEL_WIDTH_KEY = "nr:local-file-panel-width";
const ACTIVE_PANEL_KEY = "nr:local-file-active-panel";
const MIN_PANEL_WIDTH = 220;
const SOURCE_KIND_MARKERS: Record<SourceSymbol["kind"], string> = {
  命名空间: "◇", 类型: "{}", 别名: "T", 函数: "ƒ", 变量: "v", 成员: "·", 枚举值: "e", 宏: "#",
};

function storedPanelWidth() {
  const value = Number(localStorage.getItem(PANEL_WIDTH_KEY));
  return Number.isFinite(value) && value >= MIN_PANEL_WIDTH ? value : 300;
}
function storedActivePanel(): LocalPanel | null {
  const value = localStorage.getItem(ACTIVE_PANEL_KEY);
  return value === "symbols" || value === "bookmarks" || value === "matches" || value === "outline"
    ? value
    : null;
}
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

function markdownHeadingSourceOffsets(source: string): number[] {
  const offsets: number[] = [];
  const lines = source.split("\n");
  let offset = 0;
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const fenceMarker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMarker) {
      const marker = fenceMarker[1]![0]!;
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
    } else if (fence === null) {
      if (/^ {0,3}#{1,6}(?:\s+|$)/.test(line)) offsets.push(offset);
      else if (index > 0 && /^ {0,3}(?:=+|-+)\s*$/.test(line) && lines[index - 1]!.trim()) offsets.push(offset - lines[index - 1]!.length - 1);
    }
    offset += line.length + 1;
  }
  return offsets;
}

function LocalMarkdownPreview({ doc, source, onClick }: { doc: ProseMirrorNode; source: string; onClick: (event: MouseEvent<HTMLDivElement>) => void }) {
  const [states, setStates] = useState(new Map<number, ReadingBlockState>());
  const [menu, setMenu] = useState<(NotesMenuTarget & { selectedText: string }) | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const blocks: Array<{ node: ProseMirrorNode; pos: number }> = [];
  doc.forEach((node, pos) => blocks.push({ node, pos }));
  return <div ref={content} className="editor-content local-file-preview" onClick={onClick} onContextMenu={event => {
    const selection = document.getSelection();
    const selectedText = selection && !selection.isCollapsed && selection.anchorNode && event.currentTarget.contains(selection.anchorNode) ? selection.toString() : "";
    event.preventDefault();
    setMenu({ id: "local-markdown-preview", title: "本地 Markdown 预览", x: event.clientX, y: event.clientY, trigger: event.currentTarget, selectedText });
  }}><div className="ProseMirror">{blocks.map(({ node, pos }) => <div className="ProseMirror vr-block" key={pos}>{renderReadonlyBlock(node, pos, states, (position, value) => setStates(previous => new Map(previous).set(position, { ...previous.get(position), ...value })), undefined, true)}</div>)}</div>
    <div className="editor-menu local-preview-selection-commands" aria-hidden="true" hidden><button type="button" data-context-visible="true" aria-label="复制选中文本" title="复制选中文本" onClick={() => { const text = document.getSelection()?.toString(); if (text) void copyToClipboard(text, { reportFailure: true }); }}>复制</button></div>
    {menu && <NotesContextMenu target={menu} close={() => setMenu(null)} actions={menu.selectedText
      ? [{ label: "复制选中文本", run: () => { void copyToClipboard(menu.selectedText, { reportFailure: true }); } }]
      : [
        { label: "复制 Markdown 原文", run: () => { void copyToClipboard(source, { reportFailure: true }); } },
        { label: "选择全部文本", run: () => { const range = document.createRange(); if (content.current) range.selectNodeContents(content.current); const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); } },
      ]} />}
  </div>;
}

export function LocalFileView({ data, onClose, fontSize, highlightActiveLine, showLineNumbers, showStatusBar, onEditorConfigChange, active, focusMode }: {
  data: Readonly<LocalFileViewData>;
  onClose: () => void;
  fontSize: number;
  highlightActiveLine: boolean;
  showLineNumbers: boolean;
  showStatusBar: boolean;
  onEditorConfigChange?: (patch: Partial<AppConfig>) => Promise<void>;
  active: boolean;
  focusMode: boolean;
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
  const [saveState, setSaveState] = useState<"clean" | "dirty" | "saving" | "saved" | "error">("clean");
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const [previewSource, setPreviewSource] = useState("");
  const [previewError, setPreviewError] = useState("");
  const latestDraft = useRef<{ source: string; base: LocalFileSnapshot | null }>({ source: "", base: null });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [symbols, setSymbols] = useState<SourceSymbol[]>([]);
  const [symbolsAlphabetical, setSymbolsAlphabetical] = useState(false);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [symbolsBusy, setSymbolsBusy] = useState(false);
  const [foldedSymbols, setFoldedSymbols] = useState<Set<string>>(() => loadSymbolFolds(identity));
  const symbolListRef = useRef<HTMLDivElement>(null);
  const [activePanel, setActivePanel] = useState<LocalPanel | null>(storedActivePanel);
  const [foldedHeadings, setFoldedHeadings] = useState<Set<number>>(() => new Set());
  const outlineListRef = useRef<HTMLDivElement>(null);
  const [activeOffset, setActiveOffset] = useState(0);
  const [, refreshMatches] = useState(0);
  const [bookmarks, setBookmarks] = useState<LocalBookmark[]>(() => loadBookmarks(identity));
  const [panelWidth, setPanelWidth] = useState(storedPanelWidth);
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
    setActivePanel(storedActivePanel());
    setActiveOffset(0);
    setFoldedSymbols(loadSymbolFolds(identity));
    setLanguageOverride(sourceViewLanguageOverride(languageOverrideIdentity));
  }, [identity, languageOverrideIdentity]);
  useEffect(() => { localStorage.setItem(bookmarkStorageKey(identity), JSON.stringify(bookmarks)); }, [bookmarks, identity]);
  useEffect(() => { localStorage.setItem(symbolFoldsStorageKey(identity), JSON.stringify([...foldedSymbols])); }, [foldedSymbols, identity]);
  useEffect(() => {
    if (activePanel) localStorage.setItem(ACTIVE_PANEL_KEY, activePanel);
    else localStorage.removeItem(ACTIVE_PANEL_KEY);
  }, [activePanel]);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const cached = localFileSessions.get(identity);
    setLoading(true); setError(""); setBaseSnapshot(null); setExternalSnapshot(null); setSymbols([]); setSymbolsBusy(false); restoredScroll.current = false; deepFileCheckAt.current = 0;
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
      setLoading(false); setSymbolsBusy(true);
      const result = await extractSourceSymbols(language, shown, controller.signal);
      if (!disposed) { setSymbols(result ?? []); setSymbolsBusy(false); }
    }).catch(reason => { if (!disposed) { setError(String(reason)); setLoading(false); setSymbolsBusy(false); } });
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
    const sync = () => { setActiveOffset(editorHandle.selectionStart); refreshMatches(value => value + 1); schedulePositionSave(); };
    const openMatches = () => { sync(); setActivePanel("matches"); };
    sync();
    editorHandle.addEventListener("select", sync);
    editorHandle.addEventListener("keyup", sync);
    editorHandle.addEventListener("click", sync);
    editorHandle.view.dom.addEventListener("nr:source-word-update", sync);
    editorHandle.view.dom.addEventListener("nr:source-word-open", openMatches);
    editorHandle.view.scrollDOM.addEventListener("scroll", schedulePositionSave, { passive: true });
    window.addEventListener("pagehide", persistPosition);
    return () => {
      if (positionSaveTimer.current !== null) clearTimeout(positionSaveTimer.current);
      persistPosition();
      editorHandle.removeEventListener("select", sync);
      editorHandle.removeEventListener("keyup", sync);
      editorHandle.removeEventListener("click", sync);
      editorHandle.view.dom.removeEventListener("nr:source-word-update", sync);
      editorHandle.view.dom.removeEventListener("nr:source-word-open", openMatches);
      editorHandle.view.scrollDOM.removeEventListener("scroll", schedulePositionSave);
      window.removeEventListener("pagehide", persistPosition);
    };
  }, [editorHandle, identity]);

  const jump = (offset: number) => {
    const handle = sourceHandle.current;
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
  const isMarkdown = /\.(md|markdown)$/i.test(data.name);
  const isMermaid = /\.(mmd|mermaid)$/i.test(data.name);
  const isFlow = /\.flow$/i.test(data.name);
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
  const outlineDoc = useMemo(() => {
    if (!isMarkdown || activePanel !== "outline") return null;
    try { return parseFlowDocument(source); } catch { return null; }
  }, [activePanel, isMarkdown, source]);
  const markdownOutline = useMemo(() => outlineDoc ? extractDocumentOutline(outlineDoc) : [], [outlineDoc]);
  const sourceHeadingOffsets = useMemo(() => markdownHeadingSourceOffsets(source), [source]);
  const outlineEntries = useMemo<VisibleOutlineEntry[]>(() => {
    const result: VisibleOutlineEntry[] = [];
    let foldedLevel = 7;
    for (let index = 0; index < markdownOutline.length; index++) {
      const item = markdownOutline[index]!;
      if (item.level > foldedLevel) continue;
      foldedLevel = 7;
      const foldable = (markdownOutline[index + 1]?.level ?? 0) > item.level;
      result.push({ item, index, folded: foldedHeadings.has(item.pos), foldable });
      if (foldable && foldedHeadings.has(item.pos)) foldedLevel = item.level;
    }
    return result;
  }, [foldedHeadings, markdownOutline]);
  const activeOutlineIndex = useMemo(() => {
    const offset = activeOffset;
    let active = 0;
    for (let index = 0; index < sourceHeadingOffsets.length; index++) {
      if (sourceHeadingOffsets[index]! > offset) break;
      active = index;
    }
    return markdownOutline.length ? Math.min(active, markdownOutline.length - 1) : -1;
  }, [markdownOutline.length, sourceHeadingOffsets, activeOffset]);
  const jumpToOutline = (item: DocumentOutlineItem) => {
    const index = markdownOutline.findIndex(candidate => candidate.pos === item.pos);
    if (preview) {
      const host = localViewRef.current?.querySelector<HTMLElement>(".local-file-preview");
      const heading = host?.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")[index];
      if (host && heading) host.scrollTop += heading.getBoundingClientRect().top - host.getBoundingClientRect().top;
    } else {
      sourceHandle.current?.scrollToOffset(sourceHeadingOffsets[index] ?? item.pos, true);
    }
  };
  const scrollLocalDocumentTo = (target: "top" | "middle" | "bottom") => {
    const scroller = preview ? localViewRef.current?.querySelector<HTMLElement>(".local-file-preview") : sourceHandle.current?.view.scrollDOM;
    if (!scroller) return;
    const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTo({ top: target === "top" ? 0 : target === "middle" ? maximum / 2 : maximum, behavior: "auto" });
  };
  useEffect(() => {
    if (isMarkdown && activePanel === "symbols") setActivePanel("outline");
    else if (!isMarkdown && activePanel === "outline") setActivePanel(null);
  }, [activePanel, isMarkdown]);
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
  const activeSymbol = useMemo(() => symbols.reduce<SourceSymbol | null>((current, item) => item.pos <= activeOffset && (!current || item.pos > current.pos) ? item : current, null), [symbols, activeOffset]);
  const orderedSymbols = useMemo(
    () => sortSourceSymbolTree(symbols.map(symbol => ({
      ...symbol,
      sortName: sourceSymbolSortName(symbol.identity, symbol.kind, symbol.text),
    })), symbolsAlphabetical),
    [symbols, symbolsAlphabetical],
  );
  const visibleSymbols = useMemo(
    () => filterSymbolTree(orderedSymbols, symbolQuery),
    [orderedSymbols, symbolQuery],
  );
  const symbolOutline = useMemo<DocumentOutlineItem[]>(() => visibleSymbols.map(symbol => ({
    level: symbol.level,
    text: symbol.text,
    displayText: symbol.displayText,
    detail: symbol.detail,
    identity: symbol.identity,
    kind: symbol.kind,
    kindSymbol: SOURCE_KIND_MARKERS[symbol.kind],
    pos: symbol.pos,
  })), [visibleSymbols]);
  const symbolEntries = useMemo(() => {
    let hiddenBelow = Number.POSITIVE_INFINITY;
    return symbolOutline.flatMap((item, index) => {
      if (item.level > hiddenBelow) return [];
      const folded = !symbolQuery.trim() && foldedSymbols.has(item.identity ?? "");
      hiddenBelow = folded ? item.level : Number.POSITIVE_INFINITY;
      return [{ item, index, folded, foldable: (symbolOutline[index + 1]?.level ?? 0) > item.level }];
    });
  }, [foldedSymbols, symbolOutline, symbolQuery]);
  const activeSymbolIndex = activeSymbol ? orderedSymbols.findIndex(symbol => symbol.identity === activeSymbol.identity) : -1;
  const symbolBaseLevel = symbolOutline.reduce((level, item) => Math.min(level, item.level), 6);
  const wordState = editorHandle ? sourceWordState(editorHandle.view) : null;
  const matches = groupSourceWordMatchesByLine(wordState?.matches ?? []);
  const toggleBookmark = (offset?: number) => {
    const handle = sourceHandle.current;
    if (!handle) return;
    const line = handle.view.state.doc.lineAt(offset ?? handle.selectionStart);
    setBookmarks(current => {
      const existing = current.find(item => item.line === line.number);
      if (existing) return current.filter(item => item !== existing);
      return [...current, { offset: line.from, line: line.number, label: line.text.trim() || `第 ${line.number} 行` }].sort((left, right) => left.offset - right.offset);
    });
  };
  const beginPanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX, startWidth = panelWidth;
    const move = (next: PointerEvent) => setPanelWidth(Math.max(MIN_PANEL_WIDTH, Math.min(Math.max(MIN_PANEL_WIDTH, window.innerWidth * .5), startWidth + startX - next.clientX)));
    const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); setPanelWidth(value => { localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(value))); return value; }); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish, { once: true });
  };

  const panel = activePanel && activePanel !== "outline" && <aside className="local-file-dock document-panel-dock dock-right" style={{ "--local-file-panel-width": `${panelWidth}px` } as CSSProperties} aria-label={activePanel === "symbols" ? "本地源码符号" : activePanel === "bookmarks" ? "本地文件书签" : "本地文件同词匹配"}>
    <div className="document-dock-width-handle" role="separator" aria-orientation="vertical" aria-label="调整本地文件工具栏宽度" onPointerDown={beginPanelResize} />
    <div className="document-outline-header local-file-panel-header">
      <div className="document-outline-header-primary">{activePanel === "matches"
        ? <strong>{wordState?.word ? `“${wordState.word}” · ${wordState.matches.length} 处` : "同词匹配"}</strong>
        : <button type="button" className="local-file-panel-title" title={activePanel === "symbols" ? "点击收起源码符号" : "点击收起书签"} aria-label={activePanel === "symbols" ? "收起源码符号" : "收起书签"} aria-expanded onClick={() => setActivePanel(null)}><strong>{activePanel === "symbols" ? "源码符号" : "书签"}</strong></button>}</div>
      <div className={`document-outline-header-actions${activePanel === "symbols" ? " is-source-symbol-actions" : ""}`}>
        {activePanel === "symbols" && <>
          <OutlineDisplayTools listRef={symbolListRef} target="source-symbols" targetLabel="定位当前符号" />
          <button type="button" className="btn-icon" aria-label="查找符号" title="查找符号" aria-pressed={symbolSearchOpen} onClick={() => { setSymbolSearchOpen(value => !value); if (symbolSearchOpen) setSymbolQuery(""); }}><ToolbarIcon name="search" /></button>
          <button
            type="button"
            className="btn-icon source-symbol-sort-button"
            data-sort-mode={symbolsAlphabetical ? "alphabetical" : "source"}
            aria-label={symbolsAlphabetical ? "当前为分类后按字母排序，切换为分类后按源码顺序" : "当前为分类后按源码顺序，切换为分类后按字母排序"}
            title={symbolsAlphabetical ? "当前：分类固定，类别内按字母排序；点击切换为源码顺序" : "当前：分类固定，类别内按源码出现顺序；点击切换为字母顺序"}
            aria-pressed={symbolsAlphabetical}
            onClick={() => setSymbolsAlphabetical(value => !value)}
          >
            <ToolbarIcon name={symbolsAlphabetical ? "sortAlpha" : "sortSource"} />
          </button>
          <button type="button" aria-label="全部折叠" title="折叠源码符号" onClick={() => setFoldedSymbols(new Set(symbolOutline.filter((item, index) => (symbolOutline[index + 1]?.level ?? 0) > item.level).map(item => item.identity ?? "")))}>−</button>
          <button type="button" aria-label="全部展开" title="展开源码符号" onClick={() => setFoldedSymbols(new Set())}>+</button>
        </>}
        {activePanel === "bookmarks" && <button type="button" onClick={() => toggleBookmark()} title="添加或移除当前行书签"><ToolbarIcon name="plus" /></button>}
        <button type="button" onClick={() => setActivePanel(null)} title="收起侧栏" aria-label="收起侧栏"><ToolbarIcon name="close" /></button>
      </div>
    </div>
    {activePanel === "symbols" && symbolSearchOpen && <div className="source-symbol-search" role="search">
      <ToolbarIcon name="search" />
      <input autoFocus value={symbolQuery} onChange={event => setSymbolQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setSymbolQuery(""); setSymbolSearchOpen(false); } }} placeholder="查找符号" aria-label="查找符号" />
      <button type="button" className="btn-icon" aria-label="关闭符号查找" title="关闭" onClick={() => { setSymbolQuery(""); setSymbolSearchOpen(false); }}><ToolbarIcon name="close" /></button>
    </div>}
    {activePanel === "symbols" ? symbols.length ? <DocumentOutlineList entries={symbolEntries} followActive activeOutlineIndex={activeSymbolIndex} compactSymbols displayTarget="source-symbols" outlineBaseLevel={symbolBaseLevel} listRef={symbolListRef} onToggleFold={position => { const identity = symbolOutline.find(item => item.pos === position)?.identity; if (!identity) return; setFoldedSymbols(current => { const next = new Set(current); if (next.has(identity)) next.delete(identity); else next.add(identity); return next; }); }} onJump={item => jump(item.pos)} /> : <div className="local-file-panel-list"><p>{symbolsBusy ? "正在分析源码符号…" : "当前文件没有可显示的符号"}</p></div> : activePanel === "bookmarks" ? <div className="local-file-panel-list local-file-bookmark-list">
      {bookmarks.length ? bookmarks.map(bookmark => <div key={bookmark.offset} className="local-file-bookmark-row"><button type="button" onClick={() => jump(bookmark.offset)} title={bookmark.label}><span>{bookmark.line}</span><span>{bookmark.label}</span></button><button type="button" aria-label={`删除第 ${bookmark.line} 行书签`} title="删除书签" onClick={() => setBookmarks(current => current.filter(item => item !== bookmark))}><ToolbarIcon name="close" /></button></div>) : <p>当前文件还没有书签</p>}
    </div> : <div className="document-source-matches-list">
      {matches.length ? matches.map(group => { const active = group.matches.find(match => match.from === wordState?.activeFrom), target = active ?? group.matches[0]!; return <button key={group.line} type="button" className="document-source-match-row" aria-current={active ? "location" : undefined} onClick={() => { const handle = sourceHandle.current; if (!handle) return; focusSourceWordMatch(handle.view, target); handle.scrollToOffset(target.from, true); setActiveOffset(target.from); }} title={`${group.line}: ${group.text}`}><span className={`document-source-match-line${group.matches.length > 1 ? " is-repeated" : ""}`}>{group.line}</span><code>{group.text || wordState?.word}</code></button>; }) : <p>{wordState?.word ? "当前文件没有其它全词匹配" : "单击源码中的单词以查找相同词"}</p>}
    </div>}
  </aside>;

  return <section ref={localViewRef} className="local-file-view" aria-label="本地文件工作区" data-tools-hidden={!moreTools || undefined}>
    <header className="local-files-toolbar local-file-titlebar"><strong title={data.nodeId}>{data.name}</strong><span>{saveState === "saving" ? "正在保存…" : saveState === "dirty" ? "未保存" : saveState === "saved" ? "已保存" : "本地文件 · 不参与备份"}</span>
      <button type="button" className="btn-icon" title={editing ? "设为只读" : "允许编辑"} aria-label={editing ? "设为只读" : "允许编辑"} aria-pressed={readOnly} onClick={() => setLocalFileReadOnly(data.rootId, data.nodeId, !readOnly)}><ToolbarIcon name={editing ? "edit" : "lock"} /></button>
      {editing && <button type="button" className="btn-icon" title={localFileService.canSaveOriginal(data.rootId) ? "保存到原文件（⌘S / Ctrl+S）" : "目录快照不能覆盖原文件，请另存为"} aria-label="保存文件" disabled={!baseSnapshot || !localFileService.canSaveOriginal(data.rootId) || saveState === "saving" || source === baseSnapshot.source} onClick={() => void save()}><ToolbarIcon name="save" /></button>}
      <button type="button" className="btn-icon" title="另存为副本" aria-label="另存为副本" onClick={saveCopy}><ToolbarIcon name="download" /></button>
      {(isMarkdown || isMermaid || isFlow) && <button type="button" className="btn-icon" title={preview ? "显示源码" : "预览"} aria-label={preview ? "显示源码" : "预览"} aria-pressed={preview} onClick={() => setPreview(value => !value)}><ToolbarIcon name={preview ? "code" : "eye"} /></button>}
      {!preview && <button type="button" className="btn-icon" title={shortcutTitle("view.tools", "更多工具")} aria-label="更多工具" aria-expanded={moreTools} onClick={() => setMoreTools(!moreTools)}><ToolbarIcon name="annotate" /></button>}
      {(isMarkdown ? ["outline", "bookmarks", "matches"] as const : ["symbols", "bookmarks", "matches"] as const).map(kind => <button type="button" key={kind} className="btn-icon" title={kind === "outline" ? "目录" : kind === "symbols" ? "源码符号" : kind === "bookmarks" ? "书签" : "同词匹配"} aria-label={kind === "outline" ? "目录" : kind === "symbols" ? "源码符号" : kind === "bookmarks" ? "书签" : "同词匹配"} aria-pressed={activePanel === kind} disabled={loading || !!error || (kind === "symbols" && !symbols.length && !symbolsBusy)} onClick={() => setActivePanel(current => current === kind ? null : kind)}><ToolbarIcon name={kind === "outline" ? "listChars" : kind === "symbols" ? "bullet" : kind === "bookmarks" ? "bookmark" : "search"} /></button>)}
      <button type="button" className="btn-icon" title="重新读取原文件" aria-label="重新读取原文件" disabled={loading} onClick={() => { editorSession.current = null; setReload(value => value + 1); }}><ToolbarIcon name="refresh" /></button>
      <button type="button" className="btn-icon" title="返回原视图" aria-label="返回原视图" onClick={onClose}><ToolbarIcon name="chevronLeft" /></button>
    </header>
    {recoveryNotice && <p role="status" className="local-files-message">{recoveryNotice}<button type="button" onClick={() => setRecoveryNotice("")} aria-label="关闭提示">×</button></p>}
    {loading && <p role="status" className="local-files-message">正在读取文件…</p>}
    {error && <p role="alert" className="local-files-message">{error}</p>}
    {externalSnapshot && <section className="local-file-conflict" aria-label="文件冲突处理"><strong>磁盘文件已发生变化</strong><p>当前编辑和磁盘版本均已保留。比较后选择重载，或明确覆盖磁盘版本。</p>
      <TextDiffView left={externalSnapshot.source} right={source} leftLabel="磁盘版本" rightLabel="本机编辑" />
      <div><button type="button" onClick={() => { setBaseSnapshot(externalSnapshot); setSource(externalSnapshot.source); sourceRef.current = externalSnapshot.source; setExternalSnapshot(null); setSaveState("clean"); void removeLocalDraft(identity); }}>重载磁盘版本</button><button type="button" disabled={!editing || saveState === "saving"} onClick={() => void save(true)}>确认覆盖磁盘</button><button type="button" onClick={saveCopy}>另存为副本</button></div>
    </section>}
    {!loading && !error && <div className={`local-file-workspace${activePanel ? " has-local-file-dock" : ""}`} style={{ "--local-file-panel-width": `${panelWidth}px` } as CSSProperties}>
      <div className="local-file-editor-shell">{preview ? isMarkdown && markdownDoc ? <LocalMarkdownPreview doc={markdownDoc} source={source} onClick={openRelative} /> : <div className="editor-content local-file-preview">{previewError && <p role="status" className="local-files-message">{previewError}</p>}{isMermaid ? <DeferredMermaidDiagram source={source} /> : isFlow ? <FlowBlockContent source={source} /> : <pre>{source}</pre>}</div> : <MarkdownSourceEditor value={source} readonly={!editing} contextMenuEnabled onToggleLineBookmark={toggleBookmark} areaRef={sourceHandle} onReady={bindHandle} session={editorSession} onChange={next => { sourceRef.current = next; setSource(next); }} fontSize={fontSize} highlightActiveLine={highlightActiveLine} showLineNumbers={showLineNumbers} showStatusBar={showStatusBar} saveStatus={saveState} documentLanguage={language} documentLanguageValue={languageOverride ?? AUTO_DOCUMENT_LANGUAGE} documentLanguageOptions={documentLanguageViewOptions(detectedLanguage)} onDocumentLanguageChange={next => { const override = next === AUTO_DOCUMENT_LANGUAGE ? null : next; saveSourceViewLanguageOverride(languageOverrideIdentity, override); setLanguageOverride(override); }} onEditorConfigChange={onEditorConfigChange} />}</div>{panel}
      {activePanel === "outline" && <nav className="local-file-dock local-file-outline document-panel-dock dock-right" aria-label="本地文件目录">
      <div className="document-dock-width-handle" role="separator" aria-orientation="vertical" aria-label="调整本地文件目录宽度" onPointerDown={beginPanelResize} />
      <div className="document-outline-header">
        <div className="document-outline-header-primary"><strong>目录</strong><span className="document-outline-count">{markdownOutline.length} 项</span></div>
        <div className="document-outline-header-actions">
          <button type="button" aria-label="全部折叠目录" title="全部折叠目录" onClick={() => setFoldedHeadings(new Set(markdownOutline.filter((item, index) => (markdownOutline[index + 1]?.level ?? 0) > item.level).map(item => item.pos)))}>−</button>
          <button type="button" aria-label="全部展开目录" title="全部展开目录" onClick={() => setFoldedHeadings(new Set())}>+</button>
          <div className="document-outline-jumps" aria-label="目录快速滚动">
            {(["top", "middle", "bottom"] as const).map((target, index) => <button type="button" key={target} title={["单击定位目录顶部；双击滚动正文顶部", "单击定位目录中部；双击滚动正文中部", "单击定位目录底部；双击滚动正文底部"][index]} aria-label={["滚动至顶部", "滚动至中部", "滚动至底部"][index]} onClick={() => outlineListRef.current?.dispatchEvent(new CustomEvent(OUTLINE_SCROLL_EVENT, { detail: target }))} onDoubleClick={() => scrollLocalDocumentTo(target)}><ToolbarIcon name={(["pageTop", "pageMiddle", "pageBottom"] as const)[index]} /></button>)}
          </div>
          <button type="button" className="btn-icon" aria-label="收起目录" title="收起目录" onClick={() => setActivePanel(null)}><ToolbarIcon name="close" /></button>
        </div>
      </div>
      {outlineEntries.length ? <DocumentOutlineList entries={outlineEntries} activeOutlineIndex={activeOutlineIndex} followActive outlineBaseLevel={markdownOutline.reduce((level, item) => Math.min(level, item.level), 6)} listRef={outlineListRef} onToggleFold={position => setFoldedHeadings(current => { const next = new Set(current); if (next.has(position)) next.delete(position); else next.add(position); return next; })} onJump={jumpToOutline} /> : <div className="local-file-panel-list"><p>当前文档没有标题</p></div>}
    </nav>}
    </div>}
  </section>;
}
