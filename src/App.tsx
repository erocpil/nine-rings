import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNotes } from "./hooks/useNotes";
import { DatePicker } from "./components/DatePicker";
import { OverdueTodos } from "./components/OverdueTodos";
import { Sidebar } from "./components/Sidebar";
import { SearchBar } from "./components/SearchBar";
import { DailyOverview } from "./components/DailyOverview";
import { UndoToast } from "./components/UndoToast";
import type { UndoState } from "./components/UndoToast";
import { useSearch } from "./hooks/useSearch";
import { useDevImport } from "./hooks/useDevImport";
import { useNotesStore } from "./stores/useNotesStore";
import { api } from "./lib/api";
import { localDateKey } from "./lib/local-date";
import { bindViewportEdgeSwipe } from "./lib/edge-swipe";
import { useEdgeDrawer, useMobileViewport } from "./hooks/useEdgeDrawer";
import { useAutoSave } from "./hooks/useAutoSave";
import { useSettings } from "./hooks/useSettings";
import DocTree from "./components/DocTree";
import { DocMOC } from "./components/DocMOC";
import type { DeltaOps, DocumentMetadata, ExternalMarkdownSource, Note, DocType, SearchNavigationTarget } from "./types/models";
import { DEMO_CONTENT, DEMO_TITLE, DEMO_TAGS } from "./lib/demo-content";
import type { Template } from "./lib/storage/template-store";
import { templateStore } from "./lib/storage/template-store";
import { isTauriRuntime } from "./lib/runtime";
import { useClockAndDateRollover } from "./hooks/useClockAndDateRollover";
import { useAppKeyboardShortcuts } from "./hooks/useAppKeyboardShortcuts";
import { useQuickCaptureListener } from "./hooks/useQuickCaptureListener";
import { editorAppearanceVariables } from "./lib/editor-appearance";
import { isPathUnder } from "./lib/storage/core";
import { getPathAncestors } from "./lib/move-to";
import { useWebPlatform } from "./hooks/useWebPlatform";
import { WebStatusBanner } from "./components/WebStatusBanner";
import { SearchResultsPanel } from "./components/SearchResultsPanel";
import { subscribeToDataChanges } from "./lib/tab-coordination";
import { readRecentNoteIds, rememberRecentNote } from "./lib/quick-switcher";
import {
  cacheEditorDocument,
  getCachedEditorDocument,
  promoteCachedEditorDocument,
} from "./lib/editor-session-cache";
import { isDelta } from "./lib/delta-converter";
import { deltaToProseMirrorAsync } from "./lib/data-transform-client";

const WORKSPACE_TARGET_KEY = "nr:workspaceTarget";
const ACTIVE_TAG_KEY = "nr:activeTag";
const DOC_TREE_COLLAPSED_KEY = "nr:docTreeCollapsed";
const PDF_DOC_TYPE_LABELS: Record<DocType, string> = {
  explanation: "解释",
  "how-to": "指南",
  reference: "参考",
  tutorial: "教程",
};

const RecycleBin = lazy(() => import("./components/RecycleBin").then((module) => ({ default: module.RecycleBin })));
const VersionHistory = lazy(() => import("./components/VersionHistory").then((module) => ({ default: module.VersionHistory })));
const SettingsPanel = lazy(() => import("./components/SettingsPanel").then((module) => ({ default: module.SettingsPanel })));
const DebugPanel = lazy(() => import("./components/DebugPanel").then((module) => ({ default: module.DebugPanel })));
const TitleBar = lazy(() => import("./components/TitleBar"));
const PropertiesPanel = lazy(() => import("./components/PropertiesPanel"));
const DocCreateDialog = lazy(() => import("./components/DocCreateDialog"));
const QuickSwitcher = lazy(() => import("./components/QuickSwitcher"));
const PdfReader = lazy(() => import("./components/PdfReader"));
const EpubReader = lazy(() => import("./components/EpubReader"));
const TodoList = lazy(() => import("./components/TodoList")
  .then((module) => ({ default: module.TodoList })));
const loadNoteEditor = () => import("./components/NoteEditor")
  .then((module) => ({ default: module.NoteEditor }));
const NoteEditor = lazy(loadNoteEditor);

type WorkspaceTarget =
  | { kind: "note"; noteId: string }
  | { kind: "folder"; path: string }
  | { kind: "concept"; concept: string };

async function prepareEditorDocument(note: Note): Promise<void> {
  if (!isDelta(note.content) || getCachedEditorDocument(note.id, note.updated_at)) return;
  const document = await deltaToProseMirrorAsync(note.content);
  cacheEditorDocument(note.id, note.updated_at, document);
}

function readWorkspaceTarget(): WorkspaceTarget | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_TARGET_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<WorkspaceTarget>;
    if (value.kind === "note" && typeof value.noteId === "string" && value.noteId) {
      return { kind: "note", noteId: value.noteId };
    }
    if (value.kind === "folder" && typeof value.path === "string" && value.path) {
      return { kind: "folder", path: value.path };
    }
    if (value.kind === "concept" && typeof value.concept === "string" && value.concept) {
      return { kind: "concept", concept: value.concept };
    }
  } catch { /* ignore malformed legacy state */ }
  return null;
}

function saveWorkspaceTarget(target: WorkspaceTarget): void {
  localStorage.setItem(WORKSPACE_TARGET_KEY, JSON.stringify(target));
}

function App() {
  const webPlatform = useWebPlatform();

  // 先提交轻量应用外壳，再并行下载编辑器。这样低性能手机不必等待 TipTap
  // 解析完成才看到界面，同时通常能在 IndexedDB 恢复文档前完成代码预热。
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void loadNoteEditor(); });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const startupWorkspaceTargetRef = useRef<WorkspaceTarget | null>(readWorkspaceTarget());
  const startupLastNoteIdRef = useRef(localStorage.getItem("nr:lastNote"));
  const startupNoteIdRef = useRef(
    startupWorkspaceTargetRef.current?.kind === "note"
      ? startupWorkspaceTargetRef.current.noteId
      : startupWorkspaceTargetRef.current
        ? undefined
        : startupLastNoteIdRef.current ?? undefined,
  );
  const restoreWorkspaceInsteadOfNote =
    startupWorkspaceTargetRef.current?.kind === "folder"
    || startupWorkspaceTargetRef.current?.kind === "concept";
  const {
    currentDate,
    loading,
    startupReady,
    startupDateLoadPending,
    notes,
    selectedNote,
    setDate,
    selectNote,
    createNote,
    updateNote,
    deleteNote,
  } = useNotes(startupNoteIdRef.current, !restoreWorkspaceInsteadOfNote);

  const dailyPage = useNotesStore((s) => s.dailyPage);
  const updateTodos = useNotesStore((s) => s.updateTodos);
  const batchDelete = useNotesStore((s) => s.batchDelete);
  const { search, results, query, setQuery, clear: clearSearch } = useSearch();
  const [docResults, setDocResults] = useState<Note[] | null>(null);
  const [docSearchText, setDocSearchText] = useState("");
  const [docSearching, setDocSearching] = useState(false);
  const docSearchRequestIdRef = useRef(0);
  const [editorSearchTarget, setEditorSearchTarget] = useState<SearchNavigationTarget | null>(null);
  const [externalNoteConflict, setExternalNoteConflict] = useState(false);
  const [externalReloadKey, setExternalReloadKey] = useState(0);
  const searchRequestIdRef = useRef(0);

  // 恢复 GitHub 大备份时，最后打开的文档可能很大。先提交应用框架和加载提示，
  // 下一帧再构造 TipTap，避免同步的 Delta → ProseMirror 转换让窗口一直保持白屏。
  const [editorReadyNoteId, setEditorReadyNoteId] = useState<string | null>(null);
  const [startupRestoreComplete, setStartupRestoreComplete] = useState(false);
  const [secondaryUiReady, setSecondaryUiReady] = useState(false);
  const startupDateHydrationStartedRef = useRef(false);
  const selectedNoteId = selectedNote?.id ?? null;
  const selectedNoteRef = useRef(selectedNote);
  selectedNoteRef.current = selectedNote;
  useEffect(() => {
    setEditorReadyNoteId(null);
    if (!selectedNoteId || !startupRestoreComplete) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      const note = selectedNoteRef.current;
      if (!note || note.id !== selectedNoteId) return;
      void prepareEditorDocument(note)
        .catch((error) => {
          // Worker 不可用时 NoteEditor 仍可沿用同步转换路径，不能阻塞打开。
          console.warn("[Editor] 后台准备文档失败，回退到同步转换:", error);
        })
        .finally(() => {
          if (!cancelled && selectedNoteRef.current?.id === selectedNoteId) {
            setEditorReadyNoteId(selectedNoteId);
          }
        });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [selectedNoteId, startupRestoreComplete]);

  // 编辑器完成首次提交后再加载完整侧栏树。即使备份包含大量文档，应用外壳和
  // 最后文档也已经可见，后台树加载不会继续表现为启动白屏。
  useEffect(() => {
    if (!startupRestoreComplete) return;
    if (selectedNoteId && editorReadyNoteId !== selectedNoteId) return;
    const timer = window.setTimeout(() => {
      setSecondaryUiReady(true);
      if (startupDateLoadPending && !startupDateHydrationStartedRef.current) {
        startupDateHydrationStartedRef.current = true;
        void setDate(currentDate);
      }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [currentDate, editorReadyNoteId, selectedNoteId, setDate, startupDateLoadPending, startupRestoreComplete]);

  // 当前编辑器和次级界面稳定后，在浏览器空闲期预处理最近访问的另一篇
  // 文档。仅保留两份纯 JSON，不驻留额外 TipTap/DOM，适合内存受限的 iOS。
  useEffect(() => {
    if (!secondaryUiReady || !selectedNoteId || editorReadyNoteId !== selectedNoteId) return;
    const candidateId = readRecentNoteIds().find((id) => id !== selectedNoteId);
    if (!candidateId) return;
    let cancelled = false;
    const warm = () => {
      void api.notes.get(candidateId).then(async (note) => {
        if (!note || cancelled) return;
        await prepareEditorDocument(note);
      }).catch((error) => console.warn("[Editor] 空闲预处理失败:", error));
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let timer: number | undefined;
    let idle: number | undefined;
    if (idleWindow.requestIdleCallback) {
      idle = idleWindow.requestIdleCallback(warm, { timeout: 1800 });
    } else {
      timer = window.setTimeout(warm, 600);
    }
    return () => {
      cancelled = true;
      if (idle !== undefined) idleWindow.cancelIdleCallback?.(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [editorReadyNoteId, secondaryUiReady, selectedNoteId]);

  // ── 自动保存 Hook ──
  const autoSave = useAutoSave({
    onSave: async (noteId, data) => {
      const updated = await updateNote(noteId, data);
      promoteCachedEditorDocument(noteId, updated.updated_at);
    },
  });
  const flushAutoSave = autoSave.flush;
  const applyWebUpdate = useCallback(() => {
    void flushAutoSave()
      .then(webPlatform.applyUpdate)
      .catch((error) => console.error("[PWA] 刷新前保存失败，已取消更新:", error));
  }, [flushAutoSave, webPlatform.applyUpdate]);

  const exportEmergencyBackup = useCallback(async () => {
    try {
      const json = await api.export.data();
      const pending = autoSave.getPendingData();
      let backup = json;
      if (pending) {
        const parsed = JSON.parse(json) as { notes?: Array<Record<string, unknown>> };
        const target = parsed.notes?.find((note) => note.id === pending.noteId);
        if (target) Object.assign(target, pending.changes);
        backup = JSON.stringify(parsed, null, 2);
      }
      const blob = new Blob([backup], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `nine-rings-recovery-${localDateKey()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (backupError) {
      console.error("[Recovery] 紧急导出失败:", backupError);
    }
  }, [autoSave.getPendingData]);

  const retryFailedSave = useCallback(() => {
    void autoSave.flush()
      .then(() => useNotesStore.getState().clearError())
      .catch((saveError) => console.error("[Recovery] 重试保存失败:", saveError));
  }, [autoSave.flush]);

  useEffect(() => subscribeToDataChanges((event) => {
    const current = useNotesStore.getState().selectedNote;
    if (!event.noteId || event.noteId !== current?.id) return;
    if (event.type === "note-deleted") {
      setExternalNoteConflict(true);
      return;
    }
    if (autoSave.status === "dirty" || autoSave.status === "saving" || autoSave.status === "error") {
      setExternalNoteConflict(true);
      return;
    }
    void api.notes.get(event.noteId).then((note) => {
      if (!note) return;
      selectNote(note);
      setExternalReloadKey((key) => key + 1);
    });
  }), [autoSave.status, selectNote]);

  const loadExternalNote = useCallback(async () => {
    const noteId = useNotesStore.getState().selectedNote?.id;
    if (!noteId) return;
    autoSave.discardPending();
    const note = await api.notes.get(noteId);
    setExternalNoteConflict(false);
    if (note) {
      selectNote(note);
      setExternalReloadKey((key) => key + 1);
    } else {
      selectNote(null);
      void setDate(currentDate);
    }
  }, [autoSave.discardPending, currentDate, selectNote, setDate]);

  const keepLocalNote = useCallback(() => {
    setExternalNoteConflict(false);
    void autoSave.flush().catch((saveError) => console.error("[Tabs] 覆盖外部版本失败:", saveError));
  }, [autoSave.flush]);

  const handleSelectNote = useCallback((note: Note | null) => {
    if (note) {
      setSelectedFolderPath(null);
      setSelectedConcept(null);
    }
    selectNote(note);
  }, [selectNote]);

  // 所有选中路径统一在这里完成：立即切换 autosave 目标，同时串行保存旧笔记；
  // 只有旧笔记保存成功后才创建 checkpoint。
  const previousNoteIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const nextId = selectedNote?.id ?? null;
    const oldId = previousNoteIdRef.current;
    if (oldId === nextId) return;
    previousNoteIdRef.current = nextId;

    void autoSave.setNoteId(nextId)
      .then(async () => {
        if (oldId) await api.versions.checkpoint(oldId);
      })
      .catch((error) => {
        // updateNote 已同步写入全局错误栏；这里阻止失败保存继续生成旧 checkpoint。
        console.error("[App] 切换笔记前保存失败，已跳过 checkpoint:", error);
      });
  }, [selectedNote?.id, autoSave.setNoteId]);

  const handleDocSearch = useCallback(async (q: { text: string; storagePath?: string; docType?: DocType; concept?: string }) => {
    const requestId = ++docSearchRequestIdRef.current;
    if (!q.text && !q.storagePath && !q.docType && !q.concept) {
      setDocResults(null);
      setDocSearchText("");
      setDocSearching(false);
      return;
    }
    setDocSearchText(q.text || "");
    setDocResults([]);
    setDocSearching(true);
    try {
      // 搜索索引来自持久化内容；先冲刷 600ms 防抖中的编辑，避免
      // 用户刚修改正文就重新搜索时读到旧的 search_text。
      await flushAutoSave();
      if (requestId !== docSearchRequestIdRef.current) return;
      const notes = await api.docs.search({
        text: q.text || undefined,
        storagePath: q.storagePath,
        docType: q.docType,
        concept: q.concept,
      });
      if (requestId === docSearchRequestIdRef.current) {
        setDocResults(notes);
      }
    } catch (error) {
      if (requestId === docSearchRequestIdRef.current) {
        setDocResults([]);
        console.error("[App] 搜索前保存或文档搜索失败:", error);
      }
    } finally {
      if (requestId === docSearchRequestIdRef.current) {
        setDocSearching(false);
      }
    }
  }, [flushAutoSave]);

  const [recycleOpen, setRecycleOpen] = useState(false);
  const [pdfReaderDocumentId, setPdfReaderDocumentId] = useState<string | null>(null);
  const [pdfReaderTargetHighlightId, setPdfReaderTargetHighlightId] = useState<string | null>(null);
  const [pdfReaderTargetRange, setPdfReaderTargetRange] = useState<{ page: number; start: number; end: number } | null>(null);
  const [pdfReaderFullscreen, setPdfReaderFullscreen] = useState(false);
  const [epubReaderDocumentId, setEpubReaderDocumentId] = useState<string | null>(null);
  const [epubReaderTargetHighlightId, setEpubReaderTargetHighlightId] = useState<string | null>(null);
  const [epubReaderFullscreen, setEpubReaderFullscreen] = useState(false);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [docTreePopupOpen, setDocTreePopupOpen] = useState(false);
  const [docTreeToolbarHost, setDocTreeToolbarHost] = useState<HTMLDivElement | null>(null);
  const [popupDocTreeToolbarHost, setPopupDocTreeToolbarHost] = useState<HTMLDivElement | null>(null);
  const clock = useClockAndDateRollover(setDate);
  const [activeTag, setActiveTag] = useState<string | null>(() => localStorage.getItem(ACTIVE_TAG_KEY));
  const [tagFilteredNotes, setTagFilteredNotes] = useState<Note[] | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);
  const [pdfExportRequestId, setPdfExportRequestId] = useState(0);
  const [syncBusy, setSyncBusy] = useState(false);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const { config, settingsOpen, setSettingsOpen, handleConfigChange } = useSettings();
  const selectedDocumentMetadata = selectedNote?.content.metadata;
  const pdfDocumentInfo = selectedNote ? {
    author: selectedDocumentMetadata?.author || config?.user_name,
    organization: selectedDocumentMetadata?.organization || config?.user_organization,
    email: selectedDocumentMetadata?.email || config?.user_email,
    website: selectedDocumentMetadata?.website || config?.user_website,
    summary: selectedDocumentMetadata?.summary,
    keywords: selectedDocumentMetadata?.keywords,
    language: selectedDocumentMetadata?.language || config?.user_default_language,
    version: selectedDocumentMetadata?.version,
    copyright: selectedDocumentMetadata?.copyright || config?.user_copyright,
    license: selectedDocumentMetadata?.license || config?.user_default_license,
    documentType: selectedNote.docType ? PDF_DOC_TYPE_LABELS[selectedNote.docType] : undefined,
    path: selectedNote.storagePath,
    tags: selectedNote.tags,
    concepts: selectedNote.concepts,
    createdAt: selectedNote.created_at,
    updatedAt: selectedNote.updated_at,
  } : undefined;
  const handleEditorFontSizeChange = useCallback((size: number) => {
    void api.config.set({ note_font_size: Math.min(32, Math.max(12, size)) })
      .then(handleConfigChange)
      .catch((error) => console.error("[App] 保存编辑器字号失败:", error));
  }, [handleConfigChange]);
  const FOCUS_KEY = "nr:focusMode";
  const [focusMode, setFocusMode] = useState(() => {
    return localStorage.getItem(FOCUS_KEY) === "true";
  });
  const [stickyTitle, setStickyTitle] = useState<string | null>(null);
  const [documentOutlineAvailable, setDocumentOutlineAvailable] = useState(false);
  const [documentOutlineRequestId, setDocumentOutlineRequestId] = useState(0);
  const [documentBookmarkRequestId, setDocumentBookmarkRequestId] = useState(0);
  const HIDDEN_KEY = "nr:sidebarHidden";
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    const persisted = localStorage.getItem(HIDDEN_KEY);
    if (persisted !== null) return persisted === "true";
    return typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
  });
  const TAB_KEY = "nr:sidebarTab";
  const defaultViewAppliedRef = useRef(false);
  const sidebarViewTouchedRef = useRef(false);
  const [sidebarTab, setSidebarTab] = useState<'daily' | 'tree'>(() => {
    return (localStorage.getItem(TAB_KEY) as 'daily' | 'tree') || 'tree';
  });
  const handleSetSidebarTab = (tab: 'daily' | 'tree') => {
    sidebarViewTouchedRef.current = true;
    setSidebarTab(tab);
    localStorage.setItem(TAB_KEY, tab);
    if (tab === 'daily') {
      setSelectedFolderPath(null);
      setSelectedConcept(null);
      // 跨窗口 Quick Capture 事件可能在 Windows WebView2 隐藏窗口时
      // 丢失或与视图切换竞态；返回随笔视图时始终重读当日数据。
      void setDate(currentDate);
      setSidebarRefreshKey((key) => key + 1);
    }
  };
  const configuredDefaultView = config?.default_view;

  const autoCleanDaysRef = useRef<number | null>(null);
  const configuredAutoCleanDays = config?.auto_clean_days;
  useEffect(() => {
    const days = configuredAutoCleanDays;
    if (!days || autoCleanDaysRef.current === days) return;
    autoCleanDaysRef.current = days;
    void api.recycle.cleanOld(days).catch((error) => {
      autoCleanDaysRef.current = null;
      console.error("[App] 自动清理回收站失败:", error);
    });
  }, [configuredAutoCleanDays]);
  const closeSidebarOnNarrowScreen = useCallback(() => {
    if (window.matchMedia("(max-width: 768px)").matches) {
      setSidebarHidden(true);
    }
  }, []);
  const handleQuickSwitch = useCallback(async (note: Note) => {
    setQuery("");
    setDocResults(null);
    setDocSearchText("");
    setDocSearching(false);
    setQuickSwitcherOpen(false);
    if (!note.storagePath && note.date !== currentDate) await setDate(note.date);
    handleSelectNote(note);
    closeSidebarOnNarrowScreen();
  }, [closeSidebarOnNarrowScreen, currentDate, handleSelectNote, setDate, setQuery]);
  const [docCreateOpen, setDocCreateOpen] = useState(false);
  const [docTreeKey, setDocTreeKey] = useState(0);
  const [docTreeCollapsed, setDocTreeCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(DOC_TREE_COLLAPSED_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const refreshNoteViews = useCallback(() => {
    setSidebarRefreshKey((key) => key + 1);
    setDocTreeKey((key) => key + 1);
  }, []);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(() => {
    const target = startupWorkspaceTargetRef.current;
    return target?.kind === "folder" ? target.path : null;
  });
  const [selectedConcept, setSelectedConcept] = useState<string | null>(() => {
    const target = startupWorkspaceTargetRef.current;
    return target?.kind === "concept" ? target.concept : null;
  });
  const [propertiesOpen, setPropertiesOpen] = useState(false);

  useEffect(() => {
    if (!configuredDefaultView || !startupReady || defaultViewAppliedRef.current) return;
    // 默认视图是一次性冷启动决策。若将 selectedNote 作为持续依赖，点击目录
    // 时清空当前文档会再次触发它，把刚打开的目录误切回随笔页。
    defaultViewAppliedRef.current = true;
    if (localStorage.getItem("nr:defaultViewConfigured") !== "1") return;
    const startupTarget = startupWorkspaceTargetRef.current;
    const hasExplicitWorkspaceTarget = Boolean(
      selectedNote?.storagePath
      || selectedFolderPath
      || selectedConcept
      || startupTarget?.kind === "folder"
      || startupTarget?.kind === "concept"
      || sidebarViewTouchedRef.current
    );
    if (hasExplicitWorkspaceTarget) return;
    const configuredTab = configuredDefaultView === "daily" ? "daily" : "tree";
    setSidebarTab(configuredTab);
    localStorage.setItem(TAB_KEY, configuredTab);
  }, [configuredDefaultView, selectedConcept, selectedFolderPath, selectedNote?.storagePath, startupReady]);

  const revealDocTreePath = useCallback((targetPath: string, sourcePath?: string) => {
    setDocTreeCollapsed((previous) => {
      const next = new Set(previous);
      if (sourcePath) {
        for (const path of next) {
          if (isPathUnder(path, sourcePath)) next.delete(path);
        }
      }
      for (const path of getPathAncestors(targetPath)) next.delete(path);
      return next;
    });
  }, []);

  useEffect(() => {
    const documentPath = selectedNote?.storagePath;
    if (!documentPath) return;
    // 文档可能从快速切换、搜索或冷启动恢复，而此前侧栏停留在随笔页。
    // 选择文档时统一准备好文档树及其完整祖先路径；侧栏即使当前隐藏，
    // 用户在手机上再次打开时也会直接看到当前文档所在位置。
    setSidebarTab("tree");
    localStorage.setItem(TAB_KEY, "tree");
    revealDocTreePath(documentPath);
  }, [revealDocTreePath, selectedNote?.id, selectedNote?.storagePath]);

  const handleMoveDocument = useCallback(async (id: string, targetPath: string) => {
    const currentSelected = useNotesStore.getState().selectedNote;
    if (currentSelected?.id === id) await flushAutoSave();
    await api.docs.moveDocument(id, targetPath);

    // 移动 API 有意不改 updated_at；重新读取完整对象，让属性面板、后续新建
    // 文档的建议路径和启动恢复状态立即使用新位置。
    if (currentSelected?.id === id) {
      const updated = await api.notes.get(id);
      if (updated) selectNote(updated);
    }
    revealDocTreePath(targetPath);
    setDocTreeKey((key) => key + 1);
  }, [flushAutoSave, revealDocTreePath, selectNote]);

  const handleDocumentMetadataUpdate = useCallback(async (metadata: DocumentMetadata) => {
    const currentSelected = useNotesStore.getState().selectedNote;
    if (!currentSelected) throw new Error("当前没有打开的文档");
    await flushAutoSave();
    const latest = await api.notes.get(currentSelected.id);
    if (!latest) throw new Error("文档不存在或已被删除");
    const nextContent: DeltaOps = { ...latest.content };
    if (Object.keys(metadata).length > 0) nextContent.metadata = metadata;
    else delete nextContent.metadata;
    const updated = await api.notes.update(latest.id, { content: nextContent });
    selectNote(updated);
  }, [flushAutoSave, selectNote]);

  const handleExternalMarkdownApply = useCallback(async (
    content: DeltaOps,
    source: ExternalMarkdownSource,
  ) => {
    const currentSelected = useNotesStore.getState().selectedNote;
    if (!currentSelected) throw new Error("当前没有打开的文档");
    await flushAutoSave();
    const latest = await api.notes.get(currentSelected.id);
    if (!latest) throw new Error("文档不存在或已被删除");

    // 外部更新是显式替换操作。先保存当前版本，再合并远端正文与本地元信息；
    // 任一步失败都不会删除当前正文或未冲刷的编辑内容。
    await api.versions.checkpoint(latest.id);
    const nextContent: DeltaOps = {
      ...content,
      metadata: {
        ...(latest.content.metadata ?? {}),
        externalSource: { ...source, syncedAt: new Date().toISOString() },
      },
    };
    const updated = await api.notes.update(latest.id, { content: nextContent });
    const editorDocument = await deltaToProseMirrorAsync(nextContent);
    cacheEditorDocument(updated.id, updated.updated_at, editorDocument);
    selectNote(updated);
    setExternalReloadKey((key) => key + 1);
  }, [flushAutoSave, selectNote]);

  const handleExternalMarkdownDetach = useCallback(async () => {
    const currentSelected = useNotesStore.getState().selectedNote;
    if (!currentSelected) throw new Error("当前没有打开的文档");
    await flushAutoSave();
    const latest = await api.notes.get(currentSelected.id);
    if (!latest) throw new Error("文档不存在或已被删除");
    const metadata = { ...(latest.content.metadata ?? {}) };
    delete metadata.externalSource;
    const nextContent: DeltaOps = { ...latest.content };
    if (Object.keys(metadata).length > 0) nextContent.metadata = metadata;
    else delete nextContent.metadata;
    const updated = await api.notes.update(latest.id, { content: nextContent });
    selectNote(updated);
  }, [flushAutoSave, selectNote]);

  const handleBatchMoveDocuments = useCallback(async (ids: string[], targetPath: string) => {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return;
    const currentSelected = useNotesStore.getState().selectedNote;
    if (currentSelected && uniqueIds.includes(currentSelected.id)) await flushAutoSave();

    await api.docs.batchMoveDocuments(uniqueIds, targetPath);

    if (currentSelected && uniqueIds.includes(currentSelected.id)) {
      const updated = await api.notes.get(currentSelected.id);
      if (updated) selectNote(updated);
    }
    revealDocTreePath(targetPath);
    setDocTreeKey((key) => key + 1);
  }, [flushAutoSave, revealDocTreePath, selectNote]);

  const handleBatchSetReadonly = useCallback(async (ids: string[], readonly: boolean) => {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return;
    const currentSelected = useNotesStore.getState().selectedNote;
    if (currentSelected && uniqueIds.includes(currentSelected.id)) await flushAutoSave();
    await api.recycle.batch.setReadonly(uniqueIds, readonly);
    if (currentSelected && uniqueIds.includes(currentSelected.id)) {
      const updated = await api.notes.get(currentSelected.id);
      if (updated) selectNote(updated);
    }
    setDocTreeKey((key) => key + 1);
  }, [flushAutoSave, selectNote]);

  const showUndo = useCallback((nextUndo: UndoState) => {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    setUndo(nextUndo);
    undoTimerRef.current = window.setTimeout(() => {
      setUndo((current) => current?.key === nextUndo.key ? null : current);
      undoTimerRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => () => {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
  }, []);

  const handleDeleteWithUndo = useCallback(async (id: string) => {
    const current = useNotesStore.getState();
    const note = current.notes.find((item) => item.id === id)
      ?? (current.selectedNote?.id === id ? current.selectedNote : null);
    if (current.selectedNote?.id === id) await flushAutoSave();
    try {
      await deleteNote(id);
    } catch (error) {
      console.error("[App] 删除笔记失败:", error);
      return;
    }
    refreshNoteViews();
    const key = `delete-${id}-${Date.now()}`;
    showUndo({
      key,
      message: `已删除「${note?.title || "无标题"}」`,
      onUndo: async () => {
        await api.recycle.restore(id);
        await setDate(useNotesStore.getState().currentDate);
        refreshNoteViews();
      },
    });
  }, [deleteNote, flushAutoSave, refreshNoteViews, setDate, showUndo]);

  const handleBatchDeleteWithUndo = useCallback(async (ids: string[], folderPath?: string) => {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return;
    const current = useNotesStore.getState().selectedNote;
    if (current && uniqueIds.includes(current.id)) await flushAutoSave();
    try {
      await batchDelete(uniqueIds);
    } catch (error) {
      console.error("[App] 批量删除笔记失败:", error);
      return;
    }
    refreshNoteViews();
    const folderName = folderPath ? folderPath.split("/").pop() || "选中" : "选中";
    showUndo({
      key: `batch-delete-${Date.now()}`,
      message: uniqueIds.length > 1
        ? `已删除「${folderName}」及其下 ${uniqueIds.length} 篇文档`
        : `已删除「${folderName}」`,
      onUndo: async () => {
        await Promise.all(uniqueIds.map((id) => api.recycle.restore(id)));
        await setDate(useNotesStore.getState().currentDate);
        refreshNoteViews();
      },
    });
  }, [batchDelete, flushAutoSave, refreshNoteViews, setDate, showUndo]);

  const handleMoveFolder = useCallback(async (sourcePath: string, targetPath: string) => {
    const currentSelected = useNotesStore.getState().selectedNote;
    if (currentSelected?.storagePath && isPathUnder(currentSelected.storagePath, sourcePath)) {
      await flushAutoSave();
    }
    await api.docs.relocateFolder(sourcePath, targetPath);

    if (currentSelected?.storagePath && isPathUnder(currentSelected.storagePath, sourcePath)) {
      const updated = await api.notes.get(currentSelected.id);
      if (updated) selectNote(updated);
    }
    setSelectedFolderPath((currentPath) => {
      if (!currentPath || !isPathUnder(currentPath, sourcePath)) return currentPath;
      return currentPath === sourcePath
        ? targetPath
        : targetPath + currentPath.slice(sourcePath.length);
    });
    revealDocTreePath(targetPath, sourcePath);
    setDocTreeKey((key) => key + 1);
  }, [flushAutoSave, revealDocTreePath, selectNote]);

  // 主侧栏和弹出文档树共享同一个折叠集合，并统一持久化。
  useEffect(() => {
    localStorage.setItem(DOC_TREE_COLLAPSED_KEY, JSON.stringify([...docTreeCollapsed]));
  }, [docTreeCollapsed]);

  // 恢复并持续保存随笔标签筛选；失效标签只会得到空结果，不阻塞主界面。
  useEffect(() => {
    if (!secondaryUiReady) return;
    if (!activeTag) {
      localStorage.removeItem(ACTIVE_TAG_KEY);
      setTagFilteredNotes(null);
      return;
    }
    localStorage.setItem(ACTIVE_TAG_KEY, activeTag);
    let active = true;
    api.notes.listByTag(activeTag)
      .then((tagged) => { if (active) setTagFilteredNotes(tagged); })
      .catch(() => { if (active) setTagFilteredNotes([]); });
    return () => { active = false; };
  }, [activeTag, secondaryUiReady, sidebarRefreshKey]);
  const error = useNotesStore((s) => s.error);
  const clearError = useNotesStore((s) => s.clearError);

  // 文档切换后保持正文优先；属性面板仅由用户针对当前文档主动打开。
  useEffect(() => {
    setPropertiesOpen(false);
  }, [selectedNoteId]);
  const LAST_NOTE_KEY = "nr:lastNote";
  const startupRestoreCompleteRef = useRef(false);
  useEffect(() => {
    // 启动恢复完成前不写回选择，避免回退数据覆盖真正的跨日期/文档 lastNote。
    if (!selectedNoteId || !startupRestoreCompleteRef.current) return;
    localStorage.setItem(LAST_NOTE_KEY, selectedNoteId);
    rememberRecentNote(selectedNoteId);
  }, [selectedNoteId]);

  useEffect(() => {
    if (!startupRestoreCompleteRef.current) return;
    if (selectedNote) {
      saveWorkspaceTarget({ kind: "note", noteId: selectedNote.id });
    } else if (selectedConcept) {
      saveWorkspaceTarget({ kind: "concept", concept: selectedConcept });
    } else if (selectedFolderPath) {
      saveWorkspaceTarget({ kind: "folder", path: selectedFolderPath });
    }
  }, [selectedConcept, selectedFolderPath, selectedNote]);

  // ── 持久化侧栏隐藏状态 ──
  useEffect(() => {
    localStorage.setItem(HIDDEN_KEY, String(sidebarHidden));
  }, [sidebarHidden]);

  // ── 持久化专注模式 ──
  useEffect(() => {
    localStorage.setItem(FOCUS_KEY, String(focusMode));
  }, [focusMode]);

  // ── 搜索展开时自动聚焦 ──
  useEffect(() => {
    if (searchExpanded) {
      setTimeout(() => {
        document.querySelector<HTMLInputElement>(".search-input")?.focus();
      }, 50);
    }
  }, [searchExpanded]);

  // ── 禁用双指缩放（浏览器忽略 viewport user-scalable=no）
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    const preventWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    document.addEventListener("gesturestart", prevent);
    document.addEventListener("gesturechange", prevent);
    document.addEventListener("gestureend", prevent);
    document.addEventListener("wheel", preventWheel, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", prevent);
      document.removeEventListener("gesturechange", prevent);
      document.removeEventListener("gestureend", prevent);
      document.removeEventListener("wheel", preventWheel);
    };
  }, []);

  // ── Tauri 托盘事件："新建随笔" ──
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("tray-new-note", () => {
        void createNote().then(refreshNoteViews);
      }).then((fn) => { unlisten = fn; });
    }).catch(() => {});
    return () => { unlisten?.(); };
  }, [createNote, refreshNoteViews]);

  // ── Quick Capture 提交后刷新列表 ──
  useQuickCaptureListener({ setDate, onNotesChanged: refreshNoteViews });

  // 启动主键查询完成后恢复工作区。最后文档已由 useNotes.initialize 优先加载；
  // 这里仅处理目录/概念视图并开启持久化，避免再次扫描列表或重复查询正文。
  useEffect(() => {
    if (!startupReady || startupRestoreCompleteRef.current) return;
    const workspaceTarget = startupWorkspaceTargetRef.current;
    if (workspaceTarget?.kind === "folder") {
      handleSelectNote(null);
      setSelectedConcept(null);
      setSelectedFolderPath(workspaceTarget.path);
      saveWorkspaceTarget(workspaceTarget);
    } else if (workspaceTarget?.kind === "concept") {
      handleSelectNote(null);
      setSelectedFolderPath(null);
      setSelectedConcept(workspaceTarget.concept);
      saveWorkspaceTarget(workspaceTarget);
    } else if (selectedNote) {
      localStorage.setItem(LAST_NOTE_KEY, selectedNote.id);
      saveWorkspaceTarget({ kind: "note", noteId: selectedNote.id });
    }
    startupRestoreCompleteRef.current = true;
    setStartupRestoreComplete(true);
  }, [handleSelectNote, selectedNote, startupReady]);

  // ── 可拖拽分隔条 ──
  const SPLIT_KEY = "nr:todoSplit";
  const [todoFlex, setTodoFlex] = useState(() => {
    const saved = localStorage.getItem(SPLIT_KEY);
    return saved ? parseFloat(saved) : 0;
  });
  const splitRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startRatioRef = useRef(0);
  const dragRatioRef = useRef(todoFlex);
  const splitDragClickGuardRef = useRef(false);
  const splitDragClickGuardTimerRef = useRef<number | null>(null);
  const splitDragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const allowNewSplitDragAction = () => {
      if (draggingRef.current) return;
      // 新的按下/键盘操作属于用户主动输入，不是上次拖动的兼容 click。
      splitDragClickGuardRef.current = false;
      if (splitDragClickGuardTimerRef.current !== null) {
        window.clearTimeout(splitDragClickGuardTimerRef.current);
        splitDragClickGuardTimerRef.current = null;
      }
    };
    const blockSplitDragClicks = (event: Event) => {
      if (!splitDragClickGuardRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    document.addEventListener("click", blockSplitDragClicks, true);
    document.addEventListener("pointerdown", allowNewSplitDragAction, true);
    document.addEventListener("keydown", allowNewSplitDragAction, true);
    return () => {
      splitDragCleanupRef.current?.();
      document.removeEventListener("click", blockSplitDragClicks, true);
      document.removeEventListener("pointerdown", allowNewSplitDragAction, true);
      document.removeEventListener("keydown", allowNewSplitDragAction, true);
      if (splitDragClickGuardTimerRef.current !== null) {
        window.clearTimeout(splitDragClickGuardTimerRef.current);
        splitDragClickGuardTimerRef.current = null;
      }
    };
  }, []);

  const setSplitDraggingUi = (dragging: boolean) => {
    document.body.classList.toggle("app-split-dragging", dragging);
    document.body.style.userSelect = dragging ? "none" : "";
    document.body.style.webkitUserSelect = dragging ? "none" : "";
    if (draggingRef.current || dragging) {
      splitDragClickGuardRef.current = true;
      if (splitDragClickGuardTimerRef.current !== null) {
        window.clearTimeout(splitDragClickGuardTimerRef.current);
        splitDragClickGuardTimerRef.current = null;
      }
    } else {
      if (splitDragClickGuardTimerRef.current !== null) {
        window.clearTimeout(splitDragClickGuardTimerRef.current);
      }
      // 兼容 click 可能晚于 pointerup；新的主动输入会提前解除防护。
      splitDragClickGuardTimerRef.current = window.setTimeout(() => {
        splitDragClickGuardRef.current = false;
        splitDragClickGuardTimerRef.current = null;
      }, 500);
    }
    if (!dragging) return;

    // iOS may otherwise focus the todo input or retain a text selection when the
    // finger crosses it while dragging the narrow splitter hit area.
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.closest(".app-main-todo")) {
      activeElement.blur();
    }
    window.getSelection()?.removeAllRanges();
  };

  const hideTodos = useCallback(() => {
    setTodoFlex(0);
    localStorage.setItem(SPLIT_KEY, "0");
  }, []);

  const handleSplitPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    startYRef.current = e.clientY;
    startRatioRef.current = todoFlex;
    dragRatioRef.current = todoFlex;
    document.body.style.cursor = "row-resize";
    setSplitDraggingUi(true);
    const pointerId = e.pointerId;
    const divider = e.currentTarget;
    try {
      divider.setPointerCapture(pointerId);
    } catch {
      // Synthetic events and older WebViews may not expose an active pointer to capture.
    }

    const handlePointerMove = (pe: PointerEvent) => {
      if (!draggingRef.current || pe.pointerId !== pointerId || !splitRef.current?.parentElement) return;
      if (pe.cancelable) pe.preventDefault();
      const parent = splitRef.current.parentElement;
      const rect = parent.getBoundingClientRect();
      const delta = pe.clientY - startYRef.current;
      const newFlex = Math.max(0, Math.min(10, startRatioRef.current + delta / rect.height * 10));
      dragRatioRef.current = Math.round(newFlex * 10) / 10;
      setTodoFlex(dragRatioRef.current);
      localStorage.setItem(SPLIT_KEY, String(dragRatioRef.current));
    };

    const finishSplitDrag = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerEnd);
      document.removeEventListener("pointercancel", handlePointerEnd);
      divider.removeEventListener("lostpointercapture", handlePointerEnd);
      window.removeEventListener("blur", finishSplitDrag);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      splitDragCleanupRef.current = null;
      try {
        if (divider.hasPointerCapture(pointerId)) divider.releasePointerCapture(pointerId);
      } catch {
        // WebView 可能已经在窗口失焦/元素移除时释放了捕获。
      }
      document.body.style.cursor = "";
      setSplitDraggingUi(false);
      // React 可能尚未提交最后一次 pointermove；直接持久化拖动引用，
      // 避免 UI 已展开而刷新后又回到折叠状态。
      localStorage.setItem(SPLIT_KEY, String(dragRatioRef.current));
    };

    const handlePointerEnd = (pe: PointerEvent) => {
      if (pe.pointerId !== pointerId) return;
      if (pe.cancelable) pe.preventDefault();
      finishSplitDrag();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") finishSplitDrag();
    };

    splitDragCleanupRef.current = finishSplitDrag;
    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", handlePointerEnd);
    document.addEventListener("pointercancel", handlePointerEnd);
    divider.addEventListener("lostpointercapture", handlePointerEnd);
    window.addEventListener("blur", finishSplitDrag);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  };

  // ── 侧栏可拖拽分隔条 ──
  const SIDEBAR_KEY = "nr:sidebarW";
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    return saved ? parseFloat(saved) : 240;
  });
  const sideDragRef = useRef(false);
  const sideStartXRef = useRef(0);
  const sideStartWRef = useRef(0);
  const sideDragWidthRef = useRef(sidebarWidth);
  const sideDragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => sideDragCleanupRef.current?.(), []);

  const handleSidePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (sideDragRef.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    sideDragRef.current = true;
    sideStartXRef.current = e.clientX;
    sideStartWRef.current = sidebarWidth;
    sideDragWidthRef.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    const pointerId = e.pointerId;
    const divider = e.currentTarget;
    try {
      divider.setPointerCapture(pointerId);
    } catch {
      // Synthetic events and older WebViews may not expose an active pointer to capture.
    }

    const handlePointerMove = (pe: PointerEvent) => {
      if (!sideDragRef.current || pe.pointerId !== pointerId) return;
      if (pe.cancelable) pe.preventDefault();
      const delta = pe.clientX - sideStartXRef.current;
      const newW = Math.max(0, Math.min(500, sideStartWRef.current + delta));
      sideDragWidthRef.current = Math.round(newW);
      setSidebarWidth(sideDragWidthRef.current);
    };

    const finishSideDrag = () => {
      sideDragRef.current = false;
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerEnd);
      document.removeEventListener("pointercancel", handlePointerEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
      localStorage.setItem(SIDEBAR_KEY, String(sideDragWidthRef.current));
      sideDragCleanupRef.current = null;
    };

    const handlePointerEnd = (pe: PointerEvent) => {
      if (pe.pointerId !== pointerId) return;
      if (pe.cancelable) pe.preventDefault();
      finishSideDrag();
    };

    sideDragCleanupRef.current = finishSideDrag;
    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", handlePointerEnd);
    document.addEventListener("pointercancel", handlePointerEnd);
  };

  // 首次访问创建示例笔记
  useEffect(() => {
    const SEED_KEY = "nr:seeded";
    // 延迟一下确保存储就绪
    const timer = setTimeout(async () => {
      try {
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        // 检查整个工作区，避免“今天没有随笔”被误判为全新数据库。
        // 即使 IndexedDB 被清空但 localStorage 仍有标记，也能重新播种。
        const [dailyNotes, documents] = await Promise.all([
          api.notes.all(),
          api.docs.search({}),
        ]);
        if (dailyNotes.length > 0 || documents.length > 0) {
          // 已有笔记，标记已播种
          localStorage.setItem(SEED_KEY, "1");
          return;
        }
        // 整个工作区为空 → 写入示例笔记
        await api.notes.create({
          date: dateStr,
          title: DEMO_TITLE,
          content: DEMO_CONTENT as unknown as DeltaOps,
          tags: DEMO_TAGS,
        });
        localStorage.setItem(SEED_KEY, "1");
        setDate(dateStr); // 刷新
      } catch {
        // 静默忽略——非首次运行或环境问题
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [setDate]);

  // ── 键盘快捷键（浏览器 keydown + Tauri 全局热键）──
  useAppKeyboardShortcuts({
    setSettingsOpen,
    setQuickSwitcherOpen,
    setDate,
    setSidebarHidden,
    setSidebarTab: handleSetSidebarTab,
    selectNote: handleSelectNote,
    createNote,
    hotkeys: config?.hotkeys,
  });

  // ── 移动端滑动手势：左边缘右滑打开；侧栏或遮罩内左滑关闭 ──
  const sidebarPanelRef = useRef<HTMLElement>(null);
  const sidebarBackdropRef = useRef<HTMLDivElement>(null);
  const mobileDrawerViewport = useMobileViewport();
  useEdgeDrawer(mobileDrawerViewport && !sidebarHidden, "left", sidebarPanelRef, sidebarBackdropRef, () => setSidebarHidden(true));
  useEffect(() => bindViewportEdgeSwipe("left", () => {
    if (!sidebarHidden || !mobileDrawerViewport) return null;
    return () => {
      setSidebarHidden(false);
    };
  }), [mobileDrawerViewport, sidebarHidden]);

  // ── 开发模式后台导入 ──
  const refreshView = useCallback(() => {
    setDate(currentDate);
    setDocTreeKey(k => k + 1);
    setSidebarRefreshKey(k => k + 1);
  }, [currentDate, setDate]);
  useDevImport(refreshView);

  const handleDateChange = (date: string) => {
    setDate(date);
  };

  const handleTitleChange = (title: string) => {
    autoSave.markTitleDirty(title);
    // 自动保存仍负责持久化；这里先乐观更新受控标题和侧栏，避免防抖期间
    // 文档树重新查询数据库后显示旧名称。Web 与 Tauri 共用这条状态链路。
    if (selectedNote) {
      useNotesStore.setState((state) => ({
        selectedNote: state.selectedNote?.id === selectedNote.id
          ? { ...state.selectedNote, title }
          : state.selectedNote,
        notes: state.notes.map((note) => note.id === selectedNote.id ? { ...note, title } : note),
      }));
    }
  };

  const handleContentChange = (readContent: () => DeltaOps) => {
    autoSave.markContentDirty(readContent);
  };

  const handleTagsChange = (tags: string[]) => {
    autoSave.markTagsDirty(tags);
  };

  // ── 清除搜索状态（搜索结果点击 / 侧栏选择时调用）──
  const clearSearchAndSelect = useCallback((note: Note, keepSearch = false, searchTerm = "") => {
    if (searchTerm.trim()) {
      searchRequestIdRef.current += 1;
      setEditorSearchTarget({
        noteId: note.id,
        query: searchTerm.trim(),
        requestId: searchRequestIdRef.current,
      });
    }
    if (!keepSearch) {
      setQuery("");           // 仅清 query 状态，保留 SearchBar 输入框值
      setDocResults(null);    // 清除文档搜索
      setDocSearchText("");
    }
    if (note.storagePath) {
      if (sidebarTab !== "tree") {
        setSidebarTab("tree");
        localStorage.setItem(TAB_KEY, "tree");
      }
      // 再次搜索当前文档也要展开其路径，但无需重新加载或重建整棵树。
      revealDocTreePath(note.storagePath);
    }
    handleSelectNote(note);
    setDate(note.date);
  }, [
    setQuery,
    handleSelectNote,
    revealDocTreePath,
    sidebarTab,
    setDate,
  ]);

  const handleSearchTargetConsumed = useCallback((requestId: number) => {
    setEditorSearchTarget((current) => current?.requestId === requestId ? null : current);
  }, []);

  const dismissSearchResults = useCallback(() => {
    // 让仍在飞行中的请求失效；SearchBar 自己保留关键词和筛选条件。
    docSearchRequestIdRef.current += 1;
    clearSearch();
    setDocResults(null);
    setDocSearchText("");
    setDocSearching(false);
  }, [clearSearch]);

  useEffect(() => {
    if (!query && docResults === null) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dismissSearchResults();
      setSearchExpanded(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [dismissSearchResults, docResults, query]);

  if (pdfReaderDocumentId) {
    return (
      <div className="pdf-reader-app">
        {isTauriRuntime() && !pdfReaderFullscreen && (
          <Suspense fallback={null}>
            <TitleBar />
          </Suspense>
        )}
        <Suspense fallback={<div className="pdf-reader-boot">正在加载 PDF 阅读器…</div>}>
          <PdfReader
            documentId={pdfReaderDocumentId}
            initialHighlightId={pdfReaderTargetHighlightId}
            initialTargetRange={pdfReaderTargetRange}
            onFullscreenChange={setPdfReaderFullscreen}
            onCreateExcerpt={async ({ pdfId, pdfName, page, selectedText, highlightId, start, end }) => {
              await flushAutoSave();
              const excerpt = await api.notes.create({
                date: localDateKey(),
                title: `PDF 摘录 · ${pdfName} · 第 ${page} 页`,
                storagePath: "resources/pdf-excerpts",
                docType: "reference",
                concepts: ["PDF 摘录"],
                content: {
                  metadata: { pdfExcerpt: { pdfId, pdfName, page, selectedText, highlightId, anchorStart: start, anchorEnd: end } },
                  ops: [
                    { insert: selectedText },
                    { insert: "\n", attributes: { blockquote: true } },
                    { insert: `来源：${pdfName} · 第 ${page} 页` },
                    { insert: "\n" },
                  ],
                },
              });
              setPdfReaderFullscreen(false);
              setPdfReaderDocumentId(null);
              setPdfReaderTargetHighlightId(null);
              setPdfReaderTargetRange(null);
              revealDocTreePath("resources/pdf-excerpts");
              setDocTreeKey((key) => key + 1);
              selectNote(excerpt);
            }}
            onClose={() => {
              setPdfReaderFullscreen(false);
              setPdfReaderDocumentId(null);
              setPdfReaderTargetHighlightId(null);
              setPdfReaderTargetRange(null);
            }}
          />
        </Suspense>
      </div>
    );
  }

  if (epubReaderDocumentId) {
    return (
      <div className="pdf-reader-app epub-reader-app">
        {isTauriRuntime() && !epubReaderFullscreen && (
          <Suspense fallback={null}>
            <TitleBar />
          </Suspense>
        )}
        <Suspense fallback={<div className="pdf-reader-boot">正在加载 EPUB 阅读器…</div>}>
          <EpubReader
            documentId={epubReaderDocumentId}
            initialHighlightId={epubReaderTargetHighlightId}
            onFullscreenChange={setEpubReaderFullscreen}
            onCreateExcerpt={async ({ epubId, epubName, chapter, chapterTitle, selectedText, highlightId, anchor }) => {
              await flushAutoSave();
              const excerpt = await api.notes.create({
                date: localDateKey(),
                title: `EPUB 摘录 · ${epubName} · ${chapterTitle}`,
                storagePath: "resources/epub-excerpts",
                docType: "reference",
                concepts: ["EPUB 摘录"],
                content: {
                  metadata: { epubExcerpt: { epubId, epubName, chapter, chapterTitle, selectedText, highlightId, anchor } },
                  ops: [
                    { insert: selectedText },
                    { insert: "\n", attributes: { blockquote: true } },
                    { insert: `来源：${epubName} · ${chapterTitle}` },
                    { insert: "\n" },
                  ],
                },
              });
              setEpubReaderFullscreen(false);
              setEpubReaderDocumentId(null);
              setEpubReaderTargetHighlightId(null);
              revealDocTreePath("resources/epub-excerpts");
              setDocTreeKey((key) => key + 1);
              selectNote(excerpt);
            }}
            onClose={() => {
              setEpubReaderFullscreen(false);
              setEpubReaderDocumentId(null);
              setEpubReaderTargetHighlightId(null);
            }}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div
      className={`app ${focusMode ? "app-focus-mode" : ""}`}
      style={editorAppearanceVariables(config ?? undefined)}
    >
      {/* 桌面版（Tauri）才需要自定义标题栏；web 版无窗口概念 */}
      {isTauriRuntime() && (
        <Suspense fallback={null}>
          <TitleBar />
        </Suspense>
      )}
      <header className="app-header">
        {error && (
          <div className="error-bar" role="alert">
            <span>⚠ {error}</span>
            {autoSave.status === "error" && (
              <button type="button" onClick={retryFailedSave}>重试保存</button>
            )}
            {!isTauriRuntime() && (
              <button type="button" onClick={() => void exportEmergencyBackup()}>导出恢复文件</button>
            )}
            <button type="button" className="error-dismiss" onClick={clearError} aria-label="关闭错误提示">✕</button>
          </div>
        )}
        {sidebarHidden && (
          <button
            className="btn-icon btn-show-sidebar"
            onClick={() => setSidebarHidden(false)}
            title="显示侧栏"
          >
            <span className="arrow arrow-right" />
          </button>
        )}
        {sidebarHidden && (
          <button
            className="btn-icon btn-doc-tree-popup"
            onClick={() => setDocTreePopupOpen(true)}
            title="文档视图"
          >
            📂
          </button>
        )}
        <DatePicker value={currentDate} onChange={handleDateChange} />
        <span className="header-clock">{clock}</span>
        <DailyOverview />
        <span className="header-spacer" />
        {stickyTitle && (
          <div className="header-sticky-area">
            {documentOutlineAvailable ? (
              <button
                className="header-sticky-title header-sticky-title-button"
                title="打开文档目录"
                aria-label={`${stickyTitle}，打开文档目录`}
                aria-haspopup="true"
                onClick={() => setDocumentOutlineRequestId((requestId) => requestId + 1)}
                type="button"
              >
                {stickyTitle}
              </button>
            ) : (
              <span className="header-sticky-title" title={stickyTitle}>
                {stickyTitle}
              </span>
            )}
            <button
              className={`header-focus-btn ${focusMode ? "active" : ""}`}
              onClick={() => setFocusMode(!focusMode)}
              title={focusMode ? "退出专注模式" : "专注模式"}
              type="button"
            >
              {focusMode ? "⊞" : "⊟"}
            </button>
            {focusMode && (
              <button
                className="header-focus-btn"
                onClick={() => setDocumentBookmarkRequestId((requestId) => requestId + 1)}
                title="文档书签"
                aria-label="文档书签"
                type="button"
              >🔖</button>
            )}
          </div>
        )}
        <div className="header-right">
          <button
            className="btn-icon btn-quick-switcher"
            onClick={() => setQuickSwitcherOpen(true)}
            title="快速切换笔记 (Ctrl+P)"
            aria-label="快速切换笔记"
            type="button"
          >⇄</button>
          <button
            className={`btn-icon btn-search-toggle${searchExpanded ? " search-active" : ""}`}
            onClick={() => setSearchExpanded(true)}
            title="搜索"
            aria-expanded={searchExpanded}
            aria-controls="header-search"
            type="button"
          >🔍</button>
          <div id="header-search" className={`search-bar-collapse${searchExpanded ? ' expanded' : ''}`}>
            <SearchBar
              onSearch={search}
              onDocSearch={handleDocSearch}
              onInputBlur={() => setSearchExpanded(false)}
              onEscape={() => {
                dismissSearchResults();
                setSearchExpanded(false);
              }}
            />
          </div>
          <span className="header-btn-gap" />
          <button className="btn-icon" onClick={() => setSettingsOpen(true)} title="设置">
            ⚙
          </button>
        </div>
      </header>

      {!isTauriRuntime() && (
        <WebStatusBanner
          online={webPlatform.online}
          updateAvailable={webPlatform.updateAvailable}
          storagePressure={webPlatform.storagePressure}
          onApplyUpdate={applyWebUpdate}
          onExportBackup={() => void exportEmergencyBackup()}
        />
      )}

      {externalNoteConflict && (
        <div className="tab-conflict-banner" role="alert">
          <span>此笔记已在另一个标签页修改。请选择要保留的版本。</span>
          <button type="button" onClick={() => void loadExternalNote()}>载入其他标签页版本</button>
          <button type="button" onClick={keepLocalNote}>保留本页并覆盖</button>
        </div>
      )}

      <div className="app-body">
        <aside ref={sidebarPanelRef} className={`app-sidebar ${sidebarHidden ? "sidebar-hidden" : ""}`} style={{ width: sidebarHidden ? 0 : sidebarWidth }}
          role={mobileDrawerViewport ? "dialog" : undefined} aria-label={mobileDrawerViewport ? "文档侧栏" : undefined}
          aria-modal={mobileDrawerViewport && !sidebarHidden || undefined}
          aria-hidden={mobileDrawerViewport && sidebarHidden || undefined}
          {...(mobileDrawerViewport && sidebarHidden ? { inert: "" } : {})}>
          <div className="sidebar-tabs">
            <button
              className="sidebar-tab sidebar-view-switch"
              onClick={() => handleSetSidebarTab(sidebarTab === 'daily' ? 'tree' : 'daily')}
              title={sidebarTab === 'daily' ? '切换到文档' : '切换到随笔'}
              aria-label={sidebarTab === 'daily' ? '切换到文档' : '切换到随笔'}
              data-target-view={sidebarTab === 'daily' ? 'tree' : 'daily'}
            >
              <span aria-hidden="true">{sidebarTab === 'daily' ? '✏️' : '📂'}</span>
              <span className="sidebar-view-switch-label">
                {sidebarTab === 'daily' ? '随笔' : '文档'}
              </span>
            </button>
            <span className="sidebar-tab-spacer" />
            <div className="doc-tree-toolbar-host" ref={setDocTreeToolbarHost} />
            <button data-drawer-close className="btn-icon sidebar-tab-hide" onClick={() => setSidebarHidden(true)} title="隐藏侧栏">
              ◀
            </button>
          </div>

          {!secondaryUiReady ? (
            <div className="doc-tree-loading">正在加载列表...</div>
          ) : sidebarTab === 'daily' ? (
            <Sidebar
              disabled={syncBusy}
              notes={(query ? results.notes : (activeTag && tagFilteredNotes ? tagFilteredNotes : notes)).filter(n => !n.storagePath)}
              selectedId={selectedNote?.id ?? null}
              activeTag={activeTag}
              onHide={() => setSidebarHidden(true)}
              onTagSelect={(tag) => {
                setActiveTag(tag);
              }}
              onTogglePin={async (id, pinned) => {
                await updateNote(id, { pinned });
                refreshNoteViews();
              }}
              onRename={async (id, title) => {
                await updateNote(id, { title });
                refreshNoteViews();
              }}
              onSelect={(note) => {
                setQuery("");
                setDocResults(null);
                handleSelectNote(note);
                closeSidebarOnNarrowScreen();
              }}
              onCreate={() => {
                void createNote().then(refreshNoteViews);
              }}
              onCreateWithTemplate={async (template: Template) => {
                const meta = await templateStore.applyTemplate(template);
                const today = localDateKey();
                const note = await api.notes.create({
                  date: today,
                  title: meta.title ?? template.name,
                  content: meta.content,
                  tags: meta.tags,
                  storagePath: meta.storagePath ?? undefined,
                  docType: meta.docType ?? undefined,
                  concepts: meta.concepts?.length ? meta.concepts : undefined,
                  pinned: meta.pinned,
                });
                await setDate(today);
                handleSelectNote(note);
                refreshNoteViews();
              }}
              onDelete={handleDeleteWithUndo}
              onBatchDelete={handleBatchDeleteWithUndo}
              onReorder={async (id, sortOrder) => {
                await api.notes.updateOrder(id, sortOrder);
                // Refresh current date to reflect new order
                await setDate(currentDate);
                refreshNoteViews();
              }}
              onMoveToDate={async (id, date) => {
                await api.notes.update(id, { date });
                // Refresh current date to reflect removal
                await setDate(currentDate);
                refreshNoteViews();
              }}
              onToggleReadonly={async (id, readonly) => {
                await updateNote(id, { readonly });
                refreshNoteViews();
              }}
              sidebarRefreshKey={sidebarRefreshKey}
            />
          ) : (
            <DocTree
              collapsed={docTreeCollapsed}
              setCollapsed={setDocTreeCollapsed}
              disabled={syncBusy}
              toolbarHost={docTreeToolbarHost}
              onSelect={(note) => {
                setQuery("");
                setDocResults(null);
                handleSelectNote(note);
                setDate(note.date);
                closeSidebarOnNarrowScreen();
              }}
              onFolderSelect={(path) => {
                dismissSearchResults();
                setSelectedFolderPath(path);
                setSelectedConcept(null);
                handleSelectNote(null);
                closeSidebarOnNarrowScreen();
              }}
              selectedId={selectedNote?.id ?? null}
              selectedTitle={selectedNote?.title ?? undefined}
              selectedFolderPath={selectedFolderPath}
              onCreate={() => setDocCreateOpen(true)}
              refreshKey={docTreeKey}
              onRename={(id, title) => updateNote(id, { title })}
              onDelete={handleDeleteWithUndo}
              onToggleReadonly={async (id, readonly) => {
                await updateNote(id, { readonly });
                setDocTreeKey(k => k + 1);
              }}
              onMoveDocument={handleMoveDocument}
              onBatchMoveDocuments={handleBatchMoveDocuments}
              onMoveFolder={handleMoveFolder}
              onBatchDelete={handleBatchDeleteWithUndo}
              onBatchSetReadonly={async (ids, readonly) => {
                await handleBatchSetReadonly(ids, readonly);
              }}
              propertiesAutoShow={propertiesOpen}
              onTogglePropertiesAuto={() => {
                setPropertiesOpen((open) => !open);
              }}
            />
          )}
          <div className="sidebar-footer">
            <button type="button" className="sidebar-recycle-btn" onClick={() => setRecycleOpen(true)}>
              🗑 回收站
            </button>
          </div>
        </aside>

        <OverdueTodos
          open={overdueOpen}
          disabled={syncBusy}
          onClose={() => setOverdueOpen(false)}
          onOpenDate={(date) => { setQuery(""); setDocResults(null); setDate(date); }}
        />

        {!sidebarHidden && <div className="sidebar-divider" onPointerDown={handleSidePointerDown} />}

        <main className="app-main">
          {query || docResults ? (
            <SearchResultsPanel
              notes={docResults ?? results.notes}
              todos={docResults ? [] : results.todos}
              searchTerm={docResults ? docSearchText : query}
              searching={docSearching}
              onClose={dismissSearchResults}
              onSelectNote={clearSearchAndSelect}
              onSelectTodo={(date) => { setQuery(""); setDocResults(null); void setDate(date); }}
            />
          ) : selectedConcept && !selectedNote ? (
            <DocMOC
              concept={selectedConcept}
              refreshKey={docTreeKey}
              onSelect={(note) => {
                setQuery("");
                setDocResults(null);
                handleSelectNote(note);
                setDate(note.date);
                setSelectedConcept(null);
              }}
              onOpenConcept={(c) => setSelectedConcept(c)}
              selectedId={null}
            />
          ) : selectedFolderPath && sidebarTab === 'tree' && !selectedNote ? (
            <DocMOC
              storagePath={selectedFolderPath}
              refreshKey={docTreeKey}
              onSelect={(note) => {
                setQuery("");
                setDocResults(null);
                handleSelectNote(note);
                setDate(note.date);
                setSelectedFolderPath(null);
              }}
              onOpenConcept={(c) => {
                setSelectedConcept(c);
                setSelectedFolderPath(null);
              }}
              selectedId={null}
            />
          ) : (
            <div className="app-main-split" ref={splitRef}>
              {todoFlex > 0 && (
                <div
                  className={`app-main-todo ${(dailyPage?.todos.length ?? 0) === 0 ? "app-main-todo-empty" : ""}`}
                  style={{ flex: (dailyPage?.todos.length ?? 0) === 0 ? "0 0 auto" : todoFlex }}
                >
                  <Suspense fallback={<div className="empty-state">正在打开待办...</div>}>
                    <TodoList
                      disabled={syncBusy}
                      todos={dailyPage?.todos ?? []}
                      onChange={updateTodos}
                      onOpenOverdue={() => setOverdueOpen(true)}
                      onHide={hideTodos}
                    />
                  </Suspense>
                </div>
              )}
              <div
                className={`app-main-divider ${todoFlex === 0 ? "divider-collapsed" : ""}`}
                onPointerDown={handleSplitPointerDown}
              />
              <div
                className="app-main-editor"
                style={{ flex: todoFlex > 0 ? 10 - todoFlex : 1 }}
              >
                {selectedNote && editorReadyNoteId === selectedNote.id ? (
                  <Suspense fallback={<div className="empty-state">正在打开文档...</div>}>
                    <NoteEditor
                      key={`${selectedNote.id}:${externalReloadKey}`}
                      noteId={selectedNote.id}
                      focusMode={focusMode}
                      readonly={selectedNote.readonly || syncBusy}
                      onReadonlyChange={!syncBusy ? async (readonly) => {
                        await updateNote(selectedNote.id, { readonly });
                        setDocTreeKey(k => k + 1);
                        setSidebarRefreshKey(k => k + 1);
                      } : undefined}
                      title={selectedNote.title}
                      content={selectedNote.content}
                      pdfExcerptSource={selectedNote.content.metadata?.pdfExcerpt}
                      onOpenPdfExcerpt={async (source) => {
                        try {
                          await flushAutoSave();
                          const { getLocalPdf, updateLocalPdfProgress } = await import("./lib/pdf-library");
                          const stored = await getLocalPdf(source.pdfId);
                          if (!stored) throw new Error("原 PDF 已被删除");
                          await updateLocalPdfProgress(source.pdfId, {
                            page: source.page,
                            zoom: stored.entry.zoom,
                            fitWidth: stored.entry.fitWidth,
                            pageCount: stored.entry.pageCount,
                          });
                          setPdfReaderTargetHighlightId(source.highlightId ?? null);
                          setPdfReaderTargetRange(
                            source.anchorStart !== undefined && source.anchorEnd !== undefined
                              ? { page: source.page, start: source.anchorStart, end: source.anchorEnd }
                              : null,
                          );
                          setPdfReaderDocumentId(source.pdfId);
                        } catch (reason) {
                          window.alert(`无法打开 PDF 来源：${reason instanceof Error ? reason.message : String(reason)}`);
                        }
                      }}
                      epubExcerptSource={selectedNote.content.metadata?.epubExcerpt}
                      onOpenEpubExcerpt={async (source) => {
                        try {
                          await flushAutoSave();
                          const { getLocalEpub } = await import("./lib/epub-library");
                          if (!await getLocalEpub(source.epubId)) throw new Error("原 EPUB 已被删除");
                          setEpubReaderTargetHighlightId(source.highlightId ?? null);
                          setEpubReaderDocumentId(source.epubId);
                        } catch (reason) {
                          window.alert(`无法打开 EPUB 来源：${reason instanceof Error ? reason.message : String(reason)}`);
                        }
                      }}
                      contentVersion={selectedNote.updated_at}
                      pdfDocumentInfo={pdfDocumentInfo}
                      pdfExportRequestId={pdfExportRequestId}
                      tags={selectedNote.tags}
                      showLineNumbers={config?.editor_show_line_numbers ?? false}
                      showStatusBlockNumber={config?.editor_show_status_block_number ?? true}
                      showStatusBar={config?.editor_show_status_bar ?? true}
                      readonlyHeadingFoldInFocusMode={config?.editor_readonly_heading_fold ?? true}
                      vimModeEnabled={config?.editor_vim_mode ?? false}
                      defaultCodeBlockWrap={config?.editor_code_wrap_default ?? true}
                      highlightActiveLine={config?.highlight_active_line ?? true}
                      useCustomContextMenu={config?.use_custom_context_menu ?? true}
                      cjkLatinSpacing={config?.editor_cjk_spacing ?? true}
                      editorFontSize={config?.note_font_size ?? 16}
                      onEditorFontSizeChange={handleEditorFontSizeChange}
                      searchTarget={editorSearchTarget?.noteId === selectedNote.id ? editorSearchTarget : null}
                      onSearchTargetConsumed={handleSearchTargetConsumed}
                      onTitleChange={handleTitleChange}
                      onContentChange={handleContentChange}
                      onTagsChange={handleTagsChange}
                      onVersionOpen={() => setVersionOpen(true)}
                      onFocusModeChange={setFocusMode}
                      onStickyTitleChange={setStickyTitle}
                      onOutlineAvailabilityChange={setDocumentOutlineAvailable}
                      outlineRequestId={documentOutlineRequestId}
                      bookmarkRequestId={documentBookmarkRequestId}
                      saveStatus={autoSave.status}
                    />
                  </Suspense>
                ) : (
                  <div className="empty-state">
                    {selectedNote ? "正在打开文档..." : loading ? "加载中..." : "选择或新建一篇笔记"}
                  </div>
                )}
                <Suspense fallback={null}>
                  <DebugPanel />
                </Suspense>
              </div>
            </div>
          )}
        </main>

        {secondaryUiReady && selectedNote?.storagePath && propertiesOpen && (
          <Suspense fallback={null}>
            <PropertiesPanel
              readonly={selectedNote.readonly || syncBusy}
              readonlyChangeDisabled={syncBusy}
              note={selectedNote}
              onMetadataUpdate={handleDocumentMetadataUpdate}
              onMoveDocument={handleMoveDocument}
              onExportPdf={() => setPdfExportRequestId((requestId) => requestId + 1)}
              onExternalMarkdownApply={handleExternalMarkdownApply}
              onExternalMarkdownDetach={handleExternalMarkdownDetach}
              externalSourceActionsDisabled={syncBusy}
              onNoteUpdate={(updated) => {
                handleSelectNote(updated);
                refreshNoteViews();
              }}
              onClose={() => setPropertiesOpen(false)}
              onOpenConcept={(concept) => {
                setSelectedConcept(concept);
                setSelectedFolderPath(null);
                handleSelectNote(null);
                setQuery("");
                setDocResults(null);
                setPropertiesOpen(false);
              }}
            />
          </Suspense>
        )}
      </div>

      <Suspense fallback={null}>
        <QuickSwitcher
          open={quickSwitcherOpen}
          activeNoteId={selectedNote?.id ?? null}
          onClose={() => setQuickSwitcherOpen(false)}
          onSelect={handleQuickSwitch}
        />
        <SettingsPanel
          open={settingsOpen}
          webStorageStatus={isTauriRuntime() ? undefined : webPlatform.storage}
          onClose={() => setSettingsOpen(false)}
          onConfigChange={handleConfigChange}
          onOpenPdf={(documentId) => {
            void flushAutoSave()
              .then(() => {
                setSettingsOpen(false);
                setPdfReaderTargetHighlightId(null);
                setPdfReaderTargetRange(null);
                setPdfReaderDocumentId(documentId);
              })
              .catch((saveError) => console.error("[PDF] 打开阅读器前保存笔记失败:", saveError));
          }}
          onOpenEpub={(documentId) => {
            void flushAutoSave()
              .then(() => {
                setSettingsOpen(false);
                setEpubReaderTargetHighlightId(null);
                setEpubReaderDocumentId(documentId);
              })
              .catch((saveError) => console.error("[EPUB] 打开阅读器前保存笔记失败:", saveError));
          }}
          onBeforeBookmarkNoteUpdate={async (noteId) => {
            if (selectedNoteRef.current?.id === noteId) await autoSave.flush();
          }}
          onBookmarkNoteUpdated={(updated) => {
            if (selectedNoteRef.current?.id === updated.id) {
              handleSelectNote(updated);
              setExternalReloadKey((key) => key + 1);
            }
          }}
          onNotesChanged={refreshNoteViews}
          onSyncBusy={setSyncBusy}
          onImport={() => {
            // 完整恢复会同时替换数据库配置和 localStorage 中的工作区状态。
            // 先让成功反馈完成绘制，再重新载入并让所有 Hook 从恢复值初始化。
            window.setTimeout(() => window.location.reload(), 1000);
          }}
          onMarkdownImport={() => {
            setDocTreeKey((key) => key + 1);
            setSidebarRefreshKey((key) => key + 1);
            void setDate(currentDate);
          }}
          onPullDone={() => {
            window.location.reload();
          }}
        />
      </Suspense>
      {docTreePopupOpen && (
        <div className="doc-tree-popup-overlay" onClick={() => setDocTreePopupOpen(false)}>
          <div className="doc-tree-popup" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <h2>文档视图</h2>
              <div
                className="doc-tree-toolbar-host doc-tree-popup-toolbar-host"
                ref={setPopupDocTreeToolbarHost}
              />
              <button className="settings-close" onClick={() => setDocTreePopupOpen(false)}>✕</button>
            </div>
            <div className="doc-tree-popup-body">
              <DocTree
                collapsed={docTreeCollapsed}
                setCollapsed={setDocTreeCollapsed}
                toolbarHost={popupDocTreeToolbarHost}
                onSelect={(note) => {
                  setQuery("");
                  setDocResults(null);
                  handleSelectNote(note);
                  setDate(note.date);
                  setDocTreePopupOpen(false);
                }}
                onFolderSelect={(path) => {
                  dismissSearchResults();
                  setSelectedFolderPath(path);
                  setSelectedConcept(null);
                  handleSelectNote(null);
                  setDocTreePopupOpen(false);
                }}
                selectedId={selectedNote?.id ?? null}
                selectedTitle={selectedNote?.title ?? undefined}
                selectedFolderPath={selectedFolderPath}
                onCreate={() => {
                  setDocTreePopupOpen(false);
                  setDocCreateOpen(true);
                }}
                refreshKey={docTreeKey}
                onRename={(id, title) => updateNote(id, { title })}
                onDelete={handleDeleteWithUndo}
                onToggleReadonly={async (id, readonly) => {
                  await updateNote(id, { readonly });
                  setDocTreeKey(k => k + 1);
                }}
                onMoveDocument={handleMoveDocument}
                onBatchMoveDocuments={handleBatchMoveDocuments}
                onMoveFolder={handleMoveFolder}
                onBatchDelete={handleBatchDeleteWithUndo}
                onBatchSetReadonly={async (ids, readonly) => {
                  await handleBatchSetReadonly(ids, readonly);
                }}
                propertiesAutoShow={propertiesOpen}
                onTogglePropertiesAuto={() => {
                  setPropertiesOpen((open) => !open);
                }}
              />
            </div>
          </div>
        </div>
      )}
      <Suspense fallback={null}>
        <RecycleBin
          open={recycleOpen}
          onClose={() => setRecycleOpen(false)}
          onNotesChanged={() => {
            void setDate(currentDate);
            refreshNoteViews();
          }}
        />
      </Suspense>
      <UndoToast undo={undo} onDismiss={() => setUndo(null)} />
      <Suspense fallback={null}>
        <VersionHistory
          open={versionOpen}
          noteId={selectedNote?.id ?? null}
          onClose={() => setVersionOpen(false)}
          onRestore={() => {
            void setDate(currentDate);
            refreshNoteViews();
          }}
        />
      </Suspense>
      {docCreateOpen && (
        <Suspense fallback={null}>
          <DocCreateDialog
            suggestedPath={selectedNote?.storagePath || undefined}
            onClose={() => setDocCreateOpen(false)}
            onCreated={(note) => {
              setDocCreateOpen(false);
              setDocTreeKey((k) => k + 1);  // 刷新文档树
              handleSelectNote(note);
              setDate(note.date);
            }}
          />
        </Suspense>
      )}

      {/* 移动端：侧栏遮罩层（点击关闭侧栏） */}
      <div
        ref={sidebarBackdropRef}
        className={`sidebar-overlay${!sidebarHidden ? " active" : ""}`}
        onClick={() => setSidebarHidden(true)}
      />

    </div>
  );
}

export default App;
