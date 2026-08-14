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
import type { DeltaOps, Note, DocType } from "./types/models";
import { DEMO_CONTENT, DEMO_TITLE, DEMO_TAGS } from "./lib/demo-content";
import type { Template } from "./lib/storage/template-store";
import { templateStore } from "./lib/storage/template-store";
import { isTauriRuntime } from "./lib/runtime";
import { useClockAndDateRollover } from "./hooks/useClockAndDateRollover";
import { useAppKeyboardShortcuts } from "./hooks/useAppKeyboardShortcuts";
import { useQuickCaptureListener } from "./hooks/useQuickCaptureListener";

function App() {
  const {
    currentDate,
    loading,
    notes,
    selectedNote,
    setDate,
    selectNote,
    createNote,
    updateNote,
    deleteNote,
  } = useNotes();

  const dailyPage = useNotesStore((s) => s.dailyPage);
  const updateTodos = useNotesStore((s) => s.updateTodos);
  const { search, results, query, setQuery } = useSearch();
  const [docResults, setDocResults] = useState<Note[] | null>(null);
  const [docSearchText, setDocSearchText] = useState("");

  // ── 自动保存 Hook ──
  const autoSave = useAutoSave({
    onSave: async (noteId, data) => {
      await updateNote(noteId, data);
    },
  });

  const handleSelectNote = useCallback((note: Note | null) => {
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
    if (!q.text && !q.storagePath && !q.docType && !q.concept) {
      setDocResults(null);
      setDocSearchText("");
      return;
    }
    setDocSearchText(q.text || "");
    const notes = await api.docs.search({
      text: q.text || undefined,
      storagePath: q.storagePath,
      docType: q.docType,
      concept: q.concept,
    });
    setDocResults(notes);
  }, []);

  const [recycleOpen, setRecycleOpen] = useState(false);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [docTreePopupOpen, setDocTreePopupOpen] = useState(false);
  const clock = useClockAndDateRollover(setDate);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagFilteredNotes, setTagFilteredNotes] = useState<Note[] | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const { config, settingsOpen, setSettingsOpen, handleConfigChange } = useSettings();
  const FOCUS_KEY = "nr:focusMode";
  const [focusMode, setFocusMode] = useState(() => {
    return localStorage.getItem(FOCUS_KEY) === "true";
  });
  const [stickyTitle, setStickyTitle] = useState<string | null>(null);
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
      // 跨窗口 Quick Capture 事件可能在 Windows WebView2 隐藏窗口时
      // 丢失或与视图切换竞态；返回随笔视图时始终重读当日数据。
      void setDate(currentDate);
      setSidebarRefreshKey((key) => key + 1);
    }
  };
  const [docCreateOpen, setDocCreateOpen] = useState(false);
  const [docTreeKey, setDocTreeKey] = useState(0);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const [propertiesOpen, setPropertiesOpen] = useState(() => {
    return localStorage.getItem("nr:propertiesOpen") === "true";
  });
  const PROP_AUTO_KEY = "nr:propertiesAutoShow";
  const [propertiesAutoShow, setPropertiesAutoShow] = useState(() => {
    return localStorage.getItem(PROP_AUTO_KEY) === "true";
  });

  // 属性面板开/关持久化
  useEffect(() => {
    localStorage.setItem("nr:propertiesOpen", String(propertiesOpen));
  }, [propertiesOpen]);
  const error = useNotesStore((s) => s.error);
  const clearError = useNotesStore((s) => s.clearError);

  // ── 属性面板：选中文档时自动打开，选随笔时关闭 ──
  useEffect(() => {
    setPropertiesOpen(propertiesAutoShow && !!selectedNote?.storagePath);
  }, [propertiesAutoShow, selectedNote]);
  const LAST_NOTE_KEY = "nr:lastNote";
  useEffect(() => {
    if (!selectedNote) return;
    localStorage.setItem(LAST_NOTE_KEY, selectedNote.id);
  }, [selectedNote]);

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

  // 启动时恢复最后浏览的笔记（跨日查找）
  useEffect(() => {
    if (loading) return;
    const lastId = localStorage.getItem(LAST_NOTE_KEY);
    if (!lastId) return;
    // 先看当前日期列表里有没有
    const found = notes.find((n) => n.id === lastId);
    if (found) {
      handleSelectNote(found);
      return;
    }
    // 不在当前日期 → 全局查找
    api.notes.get(lastId).then((note) => {
      if (note) {
        setDate(note.date);
        handleSelectNote(note);
      }
    }).catch(() => {});
  }, [loading]);

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
  const clearSearchAndSelect = useCallback((note: Note, keepSearch = false) => {
    if (!keepSearch) {
      setQuery("");           // 仅清 query 状态，保留 SearchBar 输入框值
      setDocResults(null);    // 清除文档搜索
      setDocSearchText("");
    }
    handleSelectNote(note);
    setDate(note.date);
  }, [setQuery, selectNote, setDate]);

  return (
    <div className={`app ${focusMode ? "app-focus-mode" : ""}`}>
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
            <span className="header-sticky-title" title={stickyTitle}>
              {stickyTitle}
            </span>
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
              onEscape={() => setSearchExpanded(false)}
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
              className={`sidebar-tab ${sidebarTab === 'daily' ? 'active' : ''}`}
              onClick={() => handleSetSidebarTab('daily')}
              title="随笔"
            >
              ✏️
            </button>
            <button
              className={`sidebar-tab ${sidebarTab === 'tree' ? 'active' : ''}`}
              onClick={() => handleSetSidebarTab('tree')}
              title="文档树"
            >
              📂
            </button>
            <span className="sidebar-tab-spacer" />
            <button className="btn-icon sidebar-tab-hide" onClick={() => setSidebarHidden(true)} title="隐藏侧栏">
              ◀
            </button>
          </div>

          {sidebarTab === 'daily' ? (
            <Sidebar
              disabled={syncBusy}
              notes={(query ? results.notes : (activeTag && tagFilteredNotes ? tagFilteredNotes : notes)).filter(n => !n.storagePath)}
              selectedId={selectedNote?.id ?? null}
              activeTag={activeTag}
              onHide={() => setSidebarHidden(true)}
              onTagSelect={(tag) => {
                setActiveTag(tag);
                if (tag) {
                  api.notes.listByTag(tag).then(setTagFilteredNotes);
                } else {
                  setTagFilteredNotes(null);
                }
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
              disabled={syncBusy}
              onSelect={(note) => {
                setQuery("");
                setDocResults(null);
                handleSelectNote(note);
                setDate(note.date);
              }}
              onFolderSelect={(path) => {
                setSelectedFolderPath(path);
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
              onMoveDocument={async (id, targetPath) => {
                await api.docs.moveDocument(id, targetPath);
                setDocTreeKey(k => k + 1);
              }}
              onMoveFolder={async (sourcePath, targetPath) => {
                await api.docs.relocateFolder(sourcePath, targetPath);
                setDocTreeKey(k => k + 1);
              }}
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
            <button className="sidebar-overdue-btn" onClick={() => setOverdueOpen(true)}>
              ⚠ 过期待办
            </button>
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
              <h3>搜索结果（{(docResults ? docResults.length : results.notes.length + results.todos.length)}）</h3>
              {(docResults ? docResults : results.notes).length > 0 && (
                <div className="search-section-label">笔记</div>
              )}
              {(docResults ? docResults : results.notes).map((r) => (
                <div key={r.id} className="search-hit" onClick={(e) => clearSearchAndSelect(r, e.ctrlKey || e.metaKey)}>
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
                {selectedNote ? (
                  <NoteEditor
                    key={selectedNote.id}
                    noteId={selectedNote.id}
                    focusMode={focusMode}
                    readonly={selectedNote.readonly || syncBusy}
                    title={selectedNote.title}
                    content={selectedNote.content}
                    tags={selectedNote.tags}
                    showLineNumbers={config?.editor_show_line_numbers ?? false}
                    highlightActiveLine={config?.highlight_active_line ?? true}
                    useCustomContextMenu={config?.use_custom_context_menu ?? true}
                    onTitleChange={handleTitleChange}
                    onContentChange={handleContentChange}
                    onTagsChange={handleTagsChange}
                    onVersionOpen={() => setVersionOpen(true)}
                    onFocusModeChange={setFocusMode}
                    onStickyTitleChange={setStickyTitle}
                    saveStatus={autoSave.status}
                  />
                ) : (
                  <div className="empty-state">
                    {loading ? "加载中..." : "选择或新建一篇笔记"}
                  </div>
                )}
                <DebugPanel />
              </div>
            </div>
          )}
        </main>

        {selectedNote?.storagePath && propertiesAutoShow && propertiesOpen && (
          <PropertiesPanel
            readonly={selectedNote.readonly || syncBusy}
            note={selectedNote}
            onNoteUpdate={(updated) => { handleSelectNote(updated); setDocTreeKey(k => k + 1); }}
            onClose={() => setPropertiesOpen(false)}
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
              <button className="settings-close" onClick={() => setDocTreePopupOpen(false)}>✕</button>
            </div>
            <div className="doc-tree-popup-body">
              <DocTree
                onSelect={(note) => {
                  setQuery("");
                  setDocResults(null);
                  handleSelectNote(note);
                  setDate(note.date);
                }}
                onFolderSelect={(path) => {
                  setSelectedFolderPath(path);
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
                onMoveDocument={async (id, targetPath) => {
                  await api.docs.moveDocument(id, targetPath);
                  setDocTreeKey(k => k + 1);
                }}
                onMoveFolder={async (sourcePath, targetPath) => {
                  await api.docs.relocateFolder(sourcePath, targetPath);
                  setDocTreeKey(k => k + 1);
                }}
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
