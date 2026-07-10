import { useCallback, useEffect, useRef, useState } from "react";
import { useNotes } from "./hooks/useNotes";
import { DatePicker } from "./components/DatePicker";
import { TodoList } from "./components/TodoList";
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
import { useSearch } from "./hooks/useSearch";
import { useDevImport } from "./hooks/useDevImport";
import { useNotesStore } from "./stores/useNotesStore";
import { api } from "./lib/api";
import DocTree from "./components/DocTree";
import DocCreateDialog from "./components/DocCreateDialog";
import PropertiesPanel from "./components/PropertiesPanel";
import { DocMOC } from "./components/DocMOC";
import type { AppConfig } from "./lib/storage/types";
import type { DeltaOps, Note, DocType } from "./types/models";
import { DEMO_CONTENT, DEMO_TITLE, DEMO_TAGS } from "./lib/demo-content";

function openNewWindow() {
  // @ts-ignore
  if (typeof window === "undefined" || !window.__TAURI__) return;
  import("@tauri-apps/api/window").then(({ WebviewWindow }: any) => {
    const label = `window-${Date.now()}`;
    new WebviewWindow(label, {
      url: "/",
      title: "Nine Rings",
      width: 720,
      height: 520,
    });
  }).catch(() => {
    // 非 Tauri 环境静默忽略
  });
}

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
  const { search, results, query } = useSearch();
  const [docResults, setDocResults] = useState<Note[] | null>(null);

  const handleDocSearch = useCallback(async (q: { text: string; storagePath?: string; docType?: DocType; concept?: string }) => {
    if (!q.text && !q.storagePath && !q.docType && !q.concept) {
      setDocResults(null);
      return;
    }
    const notes = await api.docs.search({
      text: q.text || undefined,
      storagePath: q.storagePath,
      docType: q.docType,
      concept: q.concept,
    });
    setDocResults(notes);
  }, []);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [clock, setClock] = useState(() => {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  });
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagFilteredNotes, setTagFilteredNotes] = useState<Note[] | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);
  const FOCUS_KEY = "nr:focusMode";
  const [focusMode, setFocusMode] = useState(() => {
    return localStorage.getItem(FOCUS_KEY) === "true";
  });
  const [stickyTitle, setStickyTitle] = useState<string | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const HIDDEN_KEY = "nr:sidebarHidden";
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    return localStorage.getItem(HIDDEN_KEY) === "true";
  });
  const TAB_KEY = "nr:sidebarTab";
  const [sidebarTab, setSidebarTab] = useState<'daily' | 'tree'>(() => {
    return (localStorage.getItem(TAB_KEY) as 'daily' | 'tree') || 'daily';
  });
  const handleSetSidebarTab = (tab: 'daily' | 'tree') => {
    setSidebarTab(tab);
    localStorage.setItem(TAB_KEY, tab);
    if (tab === 'daily') setSelectedFolderPath(null);
  };
  const [docCreateOpen, setDocCreateOpen] = useState(false);
  const [docTreeKey, setDocTreeKey] = useState(0);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const PROP_AUTO_KEY = "nr:propertiesAutoShow";
  const [propertiesAutoShow, setPropertiesAutoShow] = useState(() => {
    return localStorage.getItem(PROP_AUTO_KEY) !== "false"; // 默认开
  });
  const error = useNotesStore((s) => s.error);
  const clearError = useNotesStore((s) => s.clearError);

  // ── 属性面板：选中文档时自动打开，选随笔时关闭 ──
  useEffect(() => {
    setPropertiesOpen(!!selectedNote?.storagePath);
  }, [selectedNote]);
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

  // 启动时恢复最后浏览的笔记（跨日查找）
  useEffect(() => {
    if (loading) return;
    const lastId = localStorage.getItem(LAST_NOTE_KEY);
    if (!lastId) return;
    // 先看当前日期列表里有没有
    const found = notes.find((n) => n.id === lastId);
    if (found) {
      selectNote(found);
      return;
    }
    // 不在当前日期 → 全局查找
    api.notes.get(lastId).then((note) => {
      if (note) {
        setDate(note.date);
        selectNote(note);
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

  // 启动时加载配置并设置主题
  useEffect(() => {
    api.config.get().then((c) => {
      applyTheme(c.theme);
      setConfig(c);
    });
  }, []);

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

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      switch (e.key.toLowerCase()) {
        case "n":
          e.preventDefault();
          createNote();
          break;
        case "e":
          e.preventDefault();
          document.querySelector<HTMLInputElement>(".search-input")?.focus();
          break;
        case ",":
          e.preventDefault();
          setSettingsOpen(true);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [createNote]);

  // ── 时钟更新 ──
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // ── 开发模式后台导入 ──
  const refreshView = useCallback(() => {
    setDate(currentDate);
    setDocTreeKey(k => k + 1);
  }, [currentDate, setDate]);
  useDevImport(refreshView);

  const handleConfigChange = useCallback((c: AppConfig) => {
    applyTheme(c.theme);
    setConfig(c);
  }, []);

  const handleDateChange = (date: string) => {
    setDate(date);
  };

  const handleTitleChange = (title: string) => {
    if (selectedNote) {
      updateNote(selectedNote.id, { title });
    }
  };

  const handleContentChange = (content: any) => {
    if (selectedNote) {
      updateNote(selectedNote.id, { content });
    }
  };

  const handleTagsChange = (tags: string[]) => {
    if (selectedNote) {
      updateNote(selectedNote.id, { tags });
    }
  };

  return (
    <div className={`app ${focusMode ? "app-focus-mode" : ""}`}>
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
        <SearchBar onSearch={search} onDocSearch={handleDocSearch} />
        <span className="header-btn-gap" />
        <button className="btn-icon" onClick={() => setSettingsOpen(true)} title="设置">
          ⚙
        </button>
        {/* @ts-ignore */}
        {typeof window !== "undefined" && (window as any).__TAURI__ && (
          <button className="btn-icon" onClick={openNewWindow} title="新窗口">
            ⊞
          </button>
        )}
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
                updateNote(id, { pinned } as any);
              }}
              onRename={(id, title) => {
                updateNote(id, { title });
              }}
              onSelect={selectNote}
              onCreate={createNote}
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
              onRecycleOpen={() => setRecycleOpen(true)}
              onReorder={async (id, sortOrder) => {
                await api.notes.updateOrder(id, sortOrder);
                // Refresh current date to reflect new order
                setDate(currentDate);
              }}
              onMoveToDate={async (id, date) => {
                await api.notes.update(id, { date } as any);
                // Refresh current date to reflect removal
                setDate(currentDate);
              }}
              onToggleReadonly={(id, readonly) => {
                updateNote(id, { readonly } as any);
              }}
            />
          ) : (
            <DocTree
              onSelect={(note) => {
                selectNote(note);
                setDate(note.date);
              }}
              onFolderSelect={setSelectedFolderPath}
              selectedId={selectedNote?.id ?? null}
              onCreate={() => setDocCreateOpen(true)}
              refreshKey={docTreeKey}
              onRename={(id, title) => updateNote(id, { title } as any)}
              onDelete={(id) => { deleteNote(id); setDocTreeKey(k => k + 1); }}
              onToggleReadonly={(id, readonly) => updateNote(id, { readonly } as any)}
              onBatchDelete={(ids) => { ids.forEach(id => deleteNote(id)); setDocTreeKey(k => k + 1); }}
              onBatchSetReadonly={(ids, readonly) => { ids.forEach(id => updateNote(id, { readonly } as any)); }}
              propertiesAutoShow={propertiesAutoShow}
              onTogglePropertiesAuto={() => {
                const next = !propertiesAutoShow;
                setPropertiesAutoShow(next);
                localStorage.setItem(PROP_AUTO_KEY, String(next));
                if (!next) setPropertiesOpen(false);
              }}
            />
          )}
        </aside>

        {!sidebarHidden && <div className="sidebar-divider" onMouseDown={handleSideMouseDown} onTouchStart={handleSideTouchStart} />}

        <main className="app-main">
          {query || docResults ? (
            <div className="search-results">
              <h3>搜索结果（{(docResults ? docResults.length : results.notes.length + results.todos.length)}）</h3>
              {(docResults ? docResults : results.notes).length > 0 && (
                <div className="search-section-label">笔记</div>
              )}
              {(docResults ? docResults : results.notes).map((r) => (
                <div key={r.id} className="search-hit" onClick={() => selectNote(r)}>
                  <div className="search-hit-title">{r.title || "无标题"}</div>
                  <div className="search-hit-date">{r.date}</div>
                  {r.storagePath && <div className="search-hit-path">{r.storagePath}</div>}
                </div>
              ))}
              {!docResults && results.todos.length > 0 && (
                <div className="search-section-label">待办</div>
              )}
              {!docResults && results.todos.map((t) => (
                <div
                  key={`todo-${t.todo.id}`}
                  className="search-hit"
                  onClick={() => setDate(t.date)}
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
              onSelect={(note) => {
                selectNote(note);
                setDate(note.date);
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
                    readonly={selectedNote.readonly}
                    title={selectedNote.title}
                    content={selectedNote.content}
                    tags={selectedNote.tags}
                    showLineNumbers={config?.editor_show_line_numbers ?? false}
                    highlightActiveLine={config?.highlight_active_line ?? true}
                    onTitleChange={handleTitleChange}
                    onContentChange={handleContentChange}
                    onTagsChange={handleTagsChange}
                    onVersionOpen={() => setVersionOpen(true)}
                    onFocusModeChange={setFocusMode}
                    onStickyTitleChange={setStickyTitle}
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
            note={selectedNote}
            onNoteUpdate={(updated) => selectNote(updated)}
            onClose={() => setPropertiesOpen(false)}
          />
        )}
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onConfigChange={handleConfigChange}
      />
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
            selectNote(note);
            setDate(note.date);
          }}
        />
      )}
    </div>
  );
}

function applyTheme(theme: string) {
  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-dark", "theme-grace", "theme-sui", "theme-zhi", "theme-azure");
  if (theme === "light") {
    root.classList.add("theme-light");
  } else if (theme === "dark") {
    root.classList.add("theme-dark");
  } else if (theme === "grace") {
    root.classList.add("theme-grace");
  } else if (theme === "sui") {
    root.classList.add("theme-sui");
  } else if (theme === "zhi") {
    root.classList.add("theme-zhi");
  } else if (theme === "azure") {
    root.classList.add("theme-azure");
  }
  // "system" → no class, falls through to @media queries
}

export default App;
