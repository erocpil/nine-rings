import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNotes } from "./hooks/useNotes";
import { DatePicker } from "./components/DatePicker";
import { TodoList } from "./components/TodoList";
import { OverdueTodos } from "./components/OverdueTodos";
import { Sidebar } from "./components/Sidebar";
import { NoteEditor } from "./components/NoteEditor";
import { SearchBar } from "./components/SearchBar";
import { DailyOverview } from "./components/DailyOverview";
import { RecycleBin } from "./components/RecycleBin";
import { UndoToast } from "./components/UndoToast";
import type { UndoState } from "./components/UndoToast";
import { VersionHistory } from "./components/VersionHistory";
import { SettingsPanel } from "./components/SettingsPanel";
import { DebugPanel } from "./components/DebugPanel";
import TitleBar from "./components/TitleBar";
import MobileToolbar from "./components/MobileToolbar";
import { useSearch } from "./hooks/useSearch";
import { useDevImport } from "./hooks/useDevImport";
import { useNotesStore } from "./stores/useNotesStore";
import { api } from "./lib/api";
import { localDateKey } from "./lib/local-date";
import { useAutoSave } from "./hooks/useAutoSave";
import { useSettings } from "./hooks/useSettings";
import { extractSnippet } from "./lib/storage/idb";
import DocTree from "./components/DocTree";
import DocCreateDialog from "./components/DocCreateDialog";
import PropertiesPanel from "./components/PropertiesPanel";
import { DocMOC } from "./components/DocMOC";
import type { DeltaOps, Note, DocType, SearchNavigationTarget } from "./types/models";
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

const WORKSPACE_TARGET_KEY = "nr:workspaceTarget";
const ACTIVE_TAG_KEY = "nr:activeTag";
const DOC_TREE_COLLAPSED_KEY = "nr:docTreeCollapsed";

type WorkspaceTarget =
  | { kind: "note"; noteId: string }
  | { kind: "folder"; path: string }
  | { kind: "concept"; concept: string };

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
  const { search, results, query, setQuery } = useSearch();
  const [docResults, setDocResults] = useState<Note[] | null>(null);
  const [docSearchText, setDocSearchText] = useState("");
  const [docSearching, setDocSearching] = useState(false);
  const docSearchRequestIdRef = useRef(0);
  const [editorSearchTarget, setEditorSearchTarget] = useState<SearchNavigationTarget | null>(null);
  const searchRequestIdRef = useRef(0);

  // 恢复 GitHub 大备份时，最后打开的文档可能很大。先提交应用框架和加载提示，
  // 下一帧再构造 TipTap，避免同步的 Delta → ProseMirror 转换让窗口一直保持白屏。
  const [editorReadyNoteId, setEditorReadyNoteId] = useState<string | null>(null);
  const [startupRestoreComplete, setStartupRestoreComplete] = useState(false);
  const [secondaryUiReady, setSecondaryUiReady] = useState(false);
  const startupDateHydrationStartedRef = useRef(false);
  const selectedNoteId = selectedNote?.id ?? null;
  useEffect(() => {
    setEditorReadyNoteId(null);
    if (!selectedNoteId || !startupRestoreComplete) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setEditorReadyNoteId(selectedNoteId);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
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

  // ── 自动保存 Hook ──
  const autoSave = useAutoSave({
    onSave: async (noteId, data) => {
      await updateNote(noteId, data);
    },
  });
  const flushAutoSave = autoSave.flush;

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
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [docTreePopupOpen, setDocTreePopupOpen] = useState(false);
  const [docTreeToolbarHost, setDocTreeToolbarHost] = useState<HTMLDivElement | null>(null);
  const [popupDocTreeToolbarHost, setPopupDocTreeToolbarHost] = useState<HTMLDivElement | null>(null);
  const clock = useClockAndDateRollover(setDate);
  const [activeTag, setActiveTag] = useState<string | null>(() => localStorage.getItem(ACTIVE_TAG_KEY));
  const [tagFilteredNotes, setTagFilteredNotes] = useState<Note[] | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const { config, settingsOpen, setSettingsOpen, handleConfigChange } = useSettings();
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
  const HIDDEN_KEY = "nr:sidebarHidden";
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [isTouchDevice] = useState(() => {
    return typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
  });
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    return localStorage.getItem(HIDDEN_KEY) === "true";
  });
  const TAB_KEY = "nr:sidebarTab";
  const [sidebarTab, setSidebarTab] = useState<'daily' | 'tree'>(() => {
    return (localStorage.getItem(TAB_KEY) as 'daily' | 'tree') || 'tree';
  });
  const handleSetSidebarTab = (tab: 'daily' | 'tree') => {
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
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(() => {
    const target = startupWorkspaceTargetRef.current;
    return target?.kind === "folder" ? target.path : null;
  });
  const [selectedConcept, setSelectedConcept] = useState<string | null>(() => {
    const target = startupWorkspaceTargetRef.current;
    return target?.kind === "concept" ? target.concept : null;
  });
  const [propertiesOpen, setPropertiesOpen] = useState(() => {
    return localStorage.getItem("nr:propertiesOpen") === "true";
  });
  const PROP_AUTO_KEY = "nr:propertiesAutoShow";
  const [propertiesAutoShow, setPropertiesAutoShow] = useState(() => {
    return localStorage.getItem(PROP_AUTO_KEY) === "true";
  });

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

  // 属性面板开/关持久化
  useEffect(() => {
    localStorage.setItem("nr:propertiesOpen", String(propertiesOpen));
  }, [propertiesOpen]);

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

  // ── 属性面板：选中文档时自动打开，选随笔时关闭 ──
  useEffect(() => {
    setPropertiesOpen(propertiesAutoShow && !!selectedNote?.storagePath);
  }, [propertiesAutoShow, selectedNote]);
  const LAST_NOTE_KEY = "nr:lastNote";
  const startupRestoreCompleteRef = useRef(false);
  useEffect(() => {
    // 启动恢复完成前不写回选择，避免回退数据覆盖真正的跨日期/文档 lastNote。
    if (!selectedNote || !startupRestoreCompleteRef.current) return;
    localStorage.setItem(LAST_NOTE_KEY, selectedNote.id);
  }, [selectedNote]);

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
        createNote();
      }).then((fn) => { unlisten = fn; });
    }).catch(() => {});
    return () => { unlisten?.(); };
  }, []); // 仅挂载一次，通过 ref 访问最新值

  // ── Quick Capture 提交后刷新列表 ──
  useQuickCaptureListener({ setDate });

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

  const handleSplitMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    startYRef.current = e.clientY;
    startRatioRef.current = todoFlex;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (me: MouseEvent) => {
      if (!draggingRef.current || !splitRef.current?.parentElement) return;
      const parent = splitRef.current.parentElement;
      const rect = parent.getBoundingClientRect();
      const delta = me.clientY - startYRef.current;
      const newFlex = Math.max(0, Math.min(10, startRatioRef.current + delta / rect.height * 10));
      setTodoFlex(Math.round(newFlex * 10) / 10);
    };

    const handleMouseUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // 持久化
      setTodoFlex((prev) => {
        localStorage.setItem(SPLIT_KEY, String(prev));
        return prev;
      });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleSplitTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 0) return;
    draggingRef.current = true;
    startYRef.current = e.touches[0].clientY;
    startRatioRef.current = todoFlex;

    const handleTouchMove = (te: TouchEvent) => {
      if (!draggingRef.current || !splitRef.current?.parentElement) return;
      const parent = splitRef.current.parentElement;
      const rect = parent.getBoundingClientRect();
      const delta = te.touches[0].clientY - startYRef.current;
      const newFlex = Math.max(0, Math.min(10, startRatioRef.current + delta / rect.height * 10));
      setTodoFlex(Math.round(newFlex * 10) / 10);
    };

    const handleTouchEnd = () => {
      draggingRef.current = false;
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setTodoFlex((prev) => {
        localStorage.setItem(SPLIT_KEY, String(prev));
        return prev;
      });
    };

    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", handleTouchEnd);
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

  const handleSideMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    sideDragRef.current = true;
    sideStartXRef.current = e.clientX;
    sideStartWRef.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (me: MouseEvent) => {
      if (!sideDragRef.current) return;
      const delta = me.clientX - sideStartXRef.current;
      const newW = Math.max(0, Math.min(500, sideStartWRef.current + delta));
      setSidebarWidth(Math.round(newW));
    };

    const handleMouseUp = () => {
      sideDragRef.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setSidebarWidth((prev) => {
        localStorage.setItem(SIDEBAR_KEY, String(prev));
        return prev;
      });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleSideTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 0) return;
    sideDragRef.current = true;
    sideStartXRef.current = e.touches[0].clientX;
    sideStartWRef.current = sidebarWidth;

    const handleTouchMove = (te: TouchEvent) => {
      if (!sideDragRef.current) return;
      const delta = te.touches[0].clientX - sideStartXRef.current;
      const newW = Math.max(0, Math.min(500, sideStartWRef.current + delta));
      setSidebarWidth(Math.round(newW));
    };

    const handleTouchEnd = () => {
      sideDragRef.current = false;
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.body.style.userSelect = "";
      setSidebarWidth((prev) => {
        localStorage.setItem(SIDEBAR_KEY, String(prev));
        return prev;
      });
    };

    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", handleTouchEnd);
  };

  // 首次访问创建示例笔记
  useEffect(() => {
    const SEED_KEY = "nr:seeded";
    // 延迟一下确保存储就绪
    const timer = setTimeout(async () => {
      try {
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        // 查询当天是否有笔记（兼容清除 IndexedDB 而 localStorage 残留的场景）
        const existing = await api.notes.listByDate(dateStr);
        if (existing.length > 0) {
          // 已有笔记，标记已播种
          localStorage.setItem(SEED_KEY, "1");
          return;
        }
        // 当天无笔记 → 写入示例笔记
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
  }, []);

  // ── 键盘快捷键（浏览器 keydown + Tauri 全局热键）──
  useAppKeyboardShortcuts({
    setSettingsOpen,
    setDate,
    setSidebarHidden,
    setSidebarTab: handleSetSidebarTab,
    selectNote: handleSelectNote,
    createNote,
    hotkeys: config?.hotkeys,
  });

  // ── 移动端滑动手势：左边缘右滑 → 打开侧栏，右滑左 → 关闭侧栏 ──
  useEffect(() => {
    let touchStartX = 0;
    let touchStartY = 0;
    const EDGE_WIDTH = 30; // 左边缘检测宽度（px）
    const SWIPE_THRESHOLD = 60; // 最小滑动距离

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      // 忽略垂直滑动
      if (Math.abs(dy) > Math.abs(dx)) return;

      if (dx > SWIPE_THRESHOLD && touchStartX < EDGE_WIDTH) {
        // 左边缘右滑 → 打开侧栏
        setSidebarHidden(false);
      } else if (dx < -SWIPE_THRESHOLD) {
        // 右滑左 → 关闭侧栏
        setSidebarHidden(true);
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

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
    // 文档笔记：实时刷新 DocTree 以同步名称
    if (selectedNote?.storagePath) {
      setDocTreeKey(k => k + 1);
    }
  };

  const handleContentChange = (content: any) => {
    autoSave.markDirty(content);
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
    handleSelectNote(note);
    setDate(note.date);
  }, [setQuery, handleSelectNote, setDate]);

  const handleSearchTargetConsumed = useCallback((requestId: number) => {
    setEditorSearchTarget((current) => current?.requestId === requestId ? null : current);
  }, []);

  const dismissSearchResults = useCallback(() => {
    // 让仍在飞行中的请求失效；SearchBar 自己保留关键词和筛选条件。
    docSearchRequestIdRef.current += 1;
    setQuery("");
    setDocResults(null);
    setDocSearchText("");
    setDocSearching(false);
  }, [setQuery]);

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

  return (
    <div
      className={`app ${focusMode ? "app-focus-mode" : ""}`}
      style={editorAppearanceVariables(config ?? undefined)}
    >
      {/* 桌面版（Tauri）才需要自定义标题栏；web 版无窗口概念 */}
      {isTauriRuntime() && <TitleBar />}
      <header className="app-header">
        {error && (
          <div className="error-bar" onClick={clearError}>
            ⚠ {error} <span className="error-dismiss">✕</span>
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
          </div>
        )}
        <div className="header-right">
          {!searchExpanded && (
          <button
            className="btn-icon btn-search-toggle"
            onClick={() => setSearchExpanded(true)}
            title="搜索"
          >🔍</button>
          )}
          <div className={`search-bar-collapse${searchExpanded ? ' expanded' : ''}`}>
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

      <div className="app-body">
        <aside className={`app-sidebar ${sidebarHidden ? "sidebar-hidden" : ""}`} style={{ width: sidebarHidden ? 0 : sidebarWidth }}>
          <div className="sidebar-tabs">
            <button
              className="sidebar-tab sidebar-view-switch"
              onClick={() => handleSetSidebarTab(sidebarTab === 'daily' ? 'tree' : 'daily')}
              title={sidebarTab === 'daily' ? '切换到文档' : '切换到随笔'}
              aria-label={sidebarTab === 'daily' ? '切换到文档' : '切换到随笔'}
              data-target-view={sidebarTab === 'daily' ? 'tree' : 'daily'}
            >
              <span aria-hidden="true">{sidebarTab === 'daily' ? '📂' : '✏️'}</span>
              <span className="sidebar-view-switch-label">
                {sidebarTab === 'daily' ? '文档' : '随笔'}
              </span>
            </button>
            <span className="sidebar-tab-spacer" />
            <div className="doc-tree-toolbar-host" ref={setDocTreeToolbarHost} />
            <button className="btn-icon sidebar-tab-hide" onClick={() => setSidebarHidden(true)} title="隐藏侧栏">
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
              onTogglePin={(id, pinned) => {
                updateNote(id, { pinned });
              }}
              onRename={(id, title) => {
                updateNote(id, { title });
              }}
              onSelect={(note) => {
                setQuery("");
                setDocResults(null);
                handleSelectNote(note);
              }}
              onCreate={createNote}
              onCreateWithTemplate={async (template: Template) => {
                const meta = await templateStore.applyTemplate(template);
                const today = localDateKey();
                const note = await api.notes.create({
                  date: today,
                  title: meta.title ?? "新随笔",
                  content: { ops: [] },
                  tags: meta.tags,
                  storagePath: meta.storagePath ?? undefined,
                  docType: meta.docType ?? undefined,
                  concepts: meta.concepts?.length ? meta.concepts : undefined,
                  pinned: meta.pinned,
                });
                setDate(today);
                handleSelectNote(note);
              }}
              onDelete={(id) => {
                // Find note for undo context
                const note = notes.find((n) => n.id === id) ?? selectedNote;
                const title = note?.title || "无标题";
                deleteNote(id);
                // Auto-dismiss after 5s
                const timer = setTimeout(() => setUndo(null), 5000);
                setUndo({
                  key: `delete-${id}`,
                  message: `已删除「${title}」`,
                  onUndo: async () => {
                    clearTimeout(timer);
                    await api.recycle.restore(id);
                    setDate(currentDate); // reload
                  },
                });
              }}
              onReorder={async (id, sortOrder) => {
                await api.notes.updateOrder(id, sortOrder);
                // Refresh current date to reflect new order
                setDate(currentDate);
              }}
              onMoveToDate={async (id, date) => {
                await api.notes.update(id, { date });
                // Refresh current date to reflect removal
                setDate(currentDate);
              }}
              onToggleReadonly={(id, readonly) => {
                updateNote(id, { readonly });
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
              }}
              onFolderSelect={(path) => {
                setSelectedFolderPath(path);
                setSelectedConcept(null);
                handleSelectNote(null);
              }}
              selectedId={selectedNote?.id ?? null}
              selectedFolderPath={selectedFolderPath}
              onCreate={() => setDocCreateOpen(true)}
              refreshKey={docTreeKey}
              onRename={(id, title) => updateNote(id, { title })}
              onDelete={(id) => {
                const note = notes.find((n) => n.id === id);
                const title = note?.title || "无标题";
                deleteNote(id);
                const timer = setTimeout(() => setUndo(null), 5000);
                setUndo({
                  key: `delete-${id}`,
                  message: `已删除「${title}」`,
                  onUndo: async () => {
                    clearTimeout(timer);
                    await api.recycle.restore(id);
                    setDocTreeKey(k => k + 1);
                  },
                });
                setDocTreeKey(k => k + 1);
              }}
              onToggleReadonly={async (id, readonly) => {
                await updateNote(id, { readonly });
                setDocTreeKey(k => k + 1);
              }}
              onMoveDocument={handleMoveDocument}
              onMoveFolder={handleMoveFolder}
              onBatchDelete={(ids, folderPath) => {
                ids.forEach(id => deleteNote(id));
                const folderName = folderPath ? folderPath.split("/").pop() || "选中" : "选中";
                const timer = setTimeout(() => setUndo(null), 5000);
                setUndo({
                  key: `batch-delete-${Date.now()}`,
                  message: ids.length > 1
                    ? `已删除「${folderName}」及其下 ${ids.length} 篇文档`
                    : `已删除「${folderName}」`,
                  onUndo: async () => {
                    clearTimeout(timer);
                    for (const id of ids) {
                      await api.recycle.restore(id);
                    }
                    setDocTreeKey(k => k + 1);
                  },
                });
                setDocTreeKey(k => k + 1);
              }}
              onBatchSetReadonly={async (ids, readonly) => {
                await Promise.all(ids.map(id => updateNote(id, { readonly })));
                setDocTreeKey(k => k + 1);
              }}
              propertiesAutoShow={propertiesAutoShow}
              onTogglePropertiesAuto={() => {
                const next = !propertiesAutoShow;
                setPropertiesAutoShow(next);
                localStorage.setItem(PROP_AUTO_KEY, String(next));
                if (next) setPropertiesOpen(true);
                else setPropertiesOpen(false);
              }}
            />
          )}
          <div className="sidebar-footer">
            <span className="sidebar-recycle-btn" onClick={() => setRecycleOpen(true)}>
              🗑 回收站
            </span>
          </div>
        </aside>

        <OverdueTodos
          open={overdueOpen}
          disabled={syncBusy}
          onClose={() => setOverdueOpen(false)}
          onOpenDate={(date) => { setQuery(""); setDocResults(null); setDate(date); }}
        />

        {!sidebarHidden && <div className="sidebar-divider" onMouseDown={handleSideMouseDown} onTouchStart={handleSideTouchStart} />}

        <main className="app-main">
          {query || docResults ? (
            <div className="search-results">
              <h3 className="search-results-header">
                <span>
                  {docSearching
                    ? "搜索中…"
                    : `搜索结果（${docResults ? docResults.length : results.notes.length + results.todos.length}）`}
                </span>
                <button type="button" onClick={dismissSearchResults} aria-label="关闭搜索结果" title="关闭搜索结果">×</button>
              </h3>
              {(docResults ? docResults : results.notes).length > 0 && (
                <div className="search-section-label">笔记</div>
              )}
              {(docResults ? docResults : results.notes).map((r) => (
                <div
                  key={r.id}
                  className="search-hit"
                  onClick={(e) => clearSearchAndSelect(
                    r,
                    e.ctrlKey || e.metaKey,
                    docResults ? docSearchText : query,
                  )}
                >
                  <div className="search-hit-title">{r.title || "无标题"}</div>
                  <div className="search-hit-date">{r.date}</div>
                  {r.storagePath && <div className="search-hit-path">{r.storagePath}</div>}
                  {(() => {
                    const targetQuery = docResults ? docSearchText : query;
                    const snippet = extractSnippet((r as any).search_text ?? "", targetQuery);
                    if (!snippet) return null;
                    return <div className="search-hit-snippet" dangerouslySetInnerHTML={{ __html: snippet }} />;
                  })()}
                </div>
              ))}
              {!docResults && results.todos.length > 0 && (
                <div className="search-section-label">待办</div>
              )}
              {!docResults && results.todos.map((t) => (
                <div
                  key={`todo-${t.todo.id}`}
                  className="search-hit"
                  onClick={() => { setQuery(""); setDocResults(null); setDate(t.date); }}
                >
                  <div className="search-hit-title">
                    <span className={`todo-dot ${t.todo.done ? "done" : ""}`}>
                      {t.todo.done ? "☑" : "☐"}
                    </span>
                    {t.todo.text}
                  </div>
                  <div className="search-hit-date">{t.date}</div>
                </div>
              ))}
            </div>
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
                  className="app-main-todo"
                  style={{ flex: todoFlex }}
                >
                  <TodoList
                    disabled={syncBusy}
                    todos={dailyPage?.todos ?? []}
                    onChange={updateTodos}
                    onOpenOverdue={() => setOverdueOpen(true)}
                  />
                </div>
              )}
              <div
                className={`app-main-divider ${todoFlex === 0 ? "divider-collapsed" : ""}`}
                onMouseDown={handleSplitMouseDown}
                onTouchStart={handleSplitTouchStart}
              />
              <div
                className="app-main-editor"
                style={{ flex: todoFlex > 0 ? 10 - todoFlex : 1 }}
              >
                {selectedNote && editorReadyNoteId === selectedNote.id ? (
                  <NoteEditor
                    key={selectedNote.id}
                    noteId={selectedNote.id}
                    focusMode={focusMode}
                    readonly={selectedNote.readonly || syncBusy}
                    title={selectedNote.title}
                    content={selectedNote.content}
                    tags={selectedNote.tags}
                    showLineNumbers={config?.editor_show_line_numbers ?? false}
                    showStatusBlockNumber={config?.editor_show_status_block_number ?? true}
                    vimModeEnabled={config?.editor_vim_mode ?? false}
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
                    saveStatus={autoSave.status}
                  />
                ) : (
                  <div className="empty-state">
                    {selectedNote ? "正在打开文档..." : loading ? "加载中..." : "选择或新建一篇笔记"}
                  </div>
                )}
                <DebugPanel />
              </div>
            </div>
          )}
        </main>

        {secondaryUiReady && selectedNote?.storagePath && propertiesAutoShow && propertiesOpen && (
          <PropertiesPanel
            readonly={selectedNote.readonly || syncBusy}
            note={selectedNote}
            onMoveDocument={handleMoveDocument}
            onNoteUpdate={(updated) => { handleSelectNote(updated); setDocTreeKey(k => k + 1); }}
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
        )}
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onConfigChange={handleConfigChange}
        onSyncBusy={setSyncBusy}
        onImport={() => {
          setDate(currentDate);
          setDocTreeKey(k => k + 1);
        }}
        onPullDone={() => {
          setDate(currentDate);
          setDocTreeKey(k => k + 1);
          setSidebarRefreshKey(k => k + 1);
        }}
      />
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
                }}
                onFolderSelect={(path) => {
                  setSelectedFolderPath(path);
                  setSelectedConcept(null);
                  handleSelectNote(null);
                }}
                selectedId={selectedNote?.id ?? null}
                selectedFolderPath={selectedFolderPath}
                onCreate={() => setDocCreateOpen(true)}
                refreshKey={docTreeKey}
                onRename={(id, title) => updateNote(id, { title })}
                onDelete={(id) => {
                const note = notes.find((n) => n.id === id);
                const title = note?.title || "无标题";
                deleteNote(id);
                const timer = setTimeout(() => setUndo(null), 5000);
                setUndo({
                  key: `delete-${id}`,
                  message: `已删除「${title}」`,
                  onUndo: async () => {
                    clearTimeout(timer);
                    await api.recycle.restore(id);
                    setDocTreeKey(k => k + 1);
                  },
                });
                setDocTreeKey(k => k + 1);
              }}
                onToggleReadonly={async (id, readonly) => {
                  await updateNote(id, { readonly });
                  setDocTreeKey(k => k + 1);
                }}
                onMoveDocument={handleMoveDocument}
                onMoveFolder={handleMoveFolder}
                onBatchDelete={(ids, folderPath) => {
                ids.forEach(id => deleteNote(id));
                const folderName = folderPath ? folderPath.split("/").pop() || "选中" : "选中";
                const timer = setTimeout(() => setUndo(null), 5000);
                setUndo({
                  key: `batch-delete-${Date.now()}`,
                  message: ids.length > 1
                    ? `已删除「${folderName}」及其下 ${ids.length} 篇文档`
                    : `已删除「${folderName}」`,
                  onUndo: async () => {
                    clearTimeout(timer);
                    for (const id of ids) {
                      await api.recycle.restore(id);
                    }
                    setDocTreeKey(k => k + 1);
                  },
                });
                setDocTreeKey(k => k + 1);
              }}
                onBatchSetReadonly={async (ids, readonly) => {
                  await Promise.all(ids.map(id => updateNote(id, { readonly })));
                  setDocTreeKey(k => k + 1);
                }}
                propertiesAutoShow={propertiesAutoShow}
                onTogglePropertiesAuto={() => {
                  const next = !propertiesAutoShow;
                  setPropertiesAutoShow(next);
                  localStorage.setItem(PROP_AUTO_KEY, String(next));
                  if (next) setPropertiesOpen(true);
                  else setPropertiesOpen(false);
                }}
              />
            </div>
          </div>
        </div>
      )}
      <RecycleBin
        open={recycleOpen}
        onClose={() => setRecycleOpen(false)}
      />
      <UndoToast undo={undo} onDismiss={() => setUndo(null)} />
      <VersionHistory
        open={versionOpen}
        noteId={selectedNote?.id ?? null}
        onClose={() => setVersionOpen(false)}
        onRestore={() => setDate(currentDate)}
      />
      {docCreateOpen && (
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
      )}

      {/* 移动端：侧栏遮罩层（点击关闭侧栏） */}
      <div
        className={`sidebar-overlay${!sidebarHidden ? " active" : ""}`}
        onClick={() => setSidebarHidden(true)}
      />

      {/* 移动端底部工具栏（仅触摸设备显示，≤768px 时 CSS 生效） */}
      {isTouchDevice && (
        <MobileToolbar
        onCreateNote={createNote}
        onToggleSidebar={() => setSidebarHidden(!sidebarHidden)}
        onFocusSearch={() => document.querySelector<HTMLInputElement>(".search-input")?.focus()}
        onOpenSettings={() => setSettingsOpen(true)}
        sidebarTab={sidebarTab}
        onToggleTab={() => handleSetSidebarTab(sidebarTab === 'daily' ? 'tree' : 'daily')}
      />
      )}
    </div>
  );
}

export default App;
