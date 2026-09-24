import { blockWorkspacePreferences, saveBlockWorkspacePreferences, BLOCK_WORKSPACE_DISPLAY_EVENT } from "../lib/block-display-settings";
import { useConfirmation } from "./ConfirmationDialog";
import { useGitHubPushJob } from "../lib/sync/push-job";
import { DisclosureIcon } from "./DisclosureIcon";
import { SettingsFoldIcons } from "./SettingsFoldIcons";
import { SettingsWorkspaceLayout } from "./SettingsWorkspaceLayout";
import { SettingsSidebarPresentation } from "./SettingsSidebarPresentation";
import { HotkeyConfig } from "./SettingsHotkeys";
import { Field, SettingsSection } from "./SettingsFields";
import { useCallback, useEffect, useState, useRef } from "react";
import "./settings-surfaces.css";
import "./settings-pages.css";
import { saveEditorAppearance, type BlockDisplayDraft } from "../lib/save-editor-appearance";
import { api } from "../lib/api";
import { localDateKey } from "../lib/local-date";
import type { AppConfig, Note } from "../types/models";
import { DAILY_NOTES_ENABLED, TODOS_ENABLED } from "../lib/workspace-features";
import { useSettingsData } from "../hooks/useSettingsData";
import { SettingsDataPage } from "./SettingsDataPage";
import { SettingsChangelog } from "./SettingsChangelog";
import { isTauri } from "../lib/tauri-desktop";
import SettingsSync from "./SettingsSync";
import { withTimeout } from "../lib/async";
import { EditorAppearancePanel } from "./EditorAppearancePanel";
import type { WebStorageStatus } from "../hooks/useWebPlatform";
import { SettingsUpdateStatus, type SettingsWebUpdate } from "./SettingsUpdateStatus";
import { useTransientMessage } from "../hooks/useTransientMessage";
import { collectWebDiagnostics } from "../lib/web-diagnostics";
import { rebuildWebSearchIndex } from "../lib/web-search-index";
import { readonlyRenderingEnabled, setReadonlyRenderingEnabled } from "../lib/readonly-rendering";
import { ToolbarIcon } from "./ToolbarIcon";
import { searchSettings, type SettingsSearchEntry } from "../lib/settings-search";
import { useMobileViewport } from "../hooks/useEdgeDrawer";
import { bindEdgeSwipe } from "../lib/edge-swipe";


interface Props {
  open: boolean;
  onClose: () => void;
  onConfigChange: (config: AppConfig) => void;
  onImport?: () => void;
  onMarkdownImport?: () => void;
  /** 同步进行中回调 — 用来 freeze 编辑区 */
  onSyncBusy?: (busy: boolean) => void;
  onBeforePush?: () => Promise<void>;
  /** Pull 完成后回调 — 重新载入并应用恢复后的设置与工作区 */
  onPullDone?: () => void;
  webStorageStatus?: WebStorageStatus;
  webUpdate?: SettingsWebUpdate;
  onBeforeBookmarkNoteUpdate?: (noteId: string) => Promise<void>;
  onBookmarkNoteUpdated?: (note: Note) => void;
  onOpenBookmark?: (noteId: string, bookmarkId: string) => Promise<void>;
  onNotesChanged?: () => void;
  libraryError?: string | null;
}

type SettingsPage = "root" | "appearance" | "navigation" | "editor" | "vim" | "sidebar" | "documents" | "bookmarks" | "general" | "profile" | "tags" | "data" | "sync" | "advanced" | "changelog";
const EDITOR_APPEARANCE_KEYS: Array<keyof AppConfig> = [
  "note_font_size",
  "editor_font_family",
  "editor_line_height",
  "editor_block_spacing",
  "editor_paragraph_indent",
  "editor_heading_margin_top",
  "editor_heading_margin_bottom",
  "editor_list_margin_top",
  "editor_list_margin_bottom",
  "editor_list_indent",
  "editor_list_marker_gap",
  "editor_blockquote_indent",
  "editor_search_highlight_color",
  "editor_cjk_spacing",
];

function pickEditorAppearanceConfig(config: AppConfig): Partial<AppConfig> {
  return Object.fromEntries(EDITOR_APPEARANCE_KEYS.map((key) => [key, config[key]])) as Partial<AppConfig>;
}

const SETTINGS_CATEGORIES: Array<{
  id: Exclude<SettingsPage, "root">;
  title: string;
  description: string;
}> = [
  { id: "appearance", title: "外观与布局", description: "主题与分栏布局" },
  { id: "editor", title: "编辑器", description: "字体排版、编辑行为、折叠与 Vim" },
  { id: "documents", title: "文档管理", description: "书签、标签和文档默认信息" },
  { id: "general", title: DAILY_NOTES_ENABLED || TODOS_ENABLED ? "工作流与快捷键" : "快捷键", description: DAILY_NOTES_ENABLED || TODOS_ENABLED ? "默认视图、待办继承和按键绑定" : "搜索、设置与窗口按键绑定" },
  { id: "sync", title: "云端同步", description: "通过 GitHub 上传、拉取与合并远端数据" },
  { id: "data", title: "备份与导入", description: "本地 JSON 备份、恢复及 Markdown / 纯文本导入" },
  { id: "advanced", title: "高级", description: isTauri() ? "回收站清理与正文渲染" : "回收站清理、渲染与诊断" },
  { id: "changelog", title: "更新记录", description: "查看近期功能改进与问题修复" },
];

const SETTINGS_PAGE_TITLES: Record<SettingsPage, string> = {
  root: "设置",
  appearance: "外观与布局",
  navigation: "导航区样式",
  editor: "编辑器",
  vim: "代码块 Vim",
  sidebar: "布局设置",
  documents: "文档管理",
  bookmarks: "书签",
  general: DAILY_NOTES_ENABLED || TODOS_ENABLED ? "工作流与快捷键" : "快捷键",
  profile: "作者与文档默认值",
  tags: "标签管理",
  data: "备份与导入",
  sync: "云端同步",
  advanced: "高级",
  changelog: "更新记录",
};

const VIM_CONFIG_KEY = "nr:vim-config";
function normalizeVimConfig(value: string): string {
  const lines = value.split(/\r?\n/).filter(Boolean);
  const options = new Map<string, string>();
  for (const line of lines) {
    const match = /^\s*set\s+([^\s=]+)(?:=(\S+))?/.exec(line);
    // 换行由“编辑器排版 → 代码／引用块显示”统一管理，避免 Vim 配置覆盖弹层设置。
    if (match && match[1] !== "wrap" && match[1] !== "nowrap") options.set(match[1], match[2] ? `set ${match[1]}=${match[2]}` : `set ${match[1]}`);
  }
  return [...options.values()].join("\n");
}


export function SettingsPanel({ open, onClose, onConfigChange, onImport, onMarkdownImport, onSyncBusy, onBeforePush, onPullDone, webStorageStatus, webUpdate, onBeforeBookmarkNoteUpdate, onBookmarkNoteUpdated, onOpenBookmark, onNotesChanged, libraryError }: Props) {
  const [vimConfig, setVimConfig] = useState(() => normalizeVimConfig(localStorage.getItem(VIM_CONFIG_KEY) ?? "set tabstop=4"));
  const saveVimConfig = (next: string) => {
    try {
      localStorage.setItem(VIM_CONFIG_KEY, next); setVimConfig(next);
      const tabSize = Number(next.match(/(?:^|\n)set tabstop=(\d+)(?:$|\n)/)?.[1]);
      if (Number.isInteger(tabSize) && tabSize >= 1 && tabSize <= 16)
        saveBlockWorkspacePreferences({ tabSize });
    }
    catch { showMessage("Vim 配置保存失败，请检查本机存储权限。"); }
  };
  useEffect(() => {
    const sync = () => setVimConfig(current => {
      const tabSize = blockWorkspacePreferences().tabSize ?? 4;
      if (Number(current.match(/tabstop=(\d+)/)?.[1]) === tabSize) return current;
      return [...normalizeVimConfig(current).split("\n").filter(line => line && !/^set tabstop(?:=|$)/.test(line)), `set tabstop=${tabSize}`].join("\n");
    });
    sync();
    window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, sync);
    return () => window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, sync);
  }, []);
  const [panelOrder, setPanelOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem("nr:sidebarOrder")?.split(",") ?? [];
    return [...new Set(saved.filter((item) => ["tree", "list", "reader"].includes(item))), ...["tree", "list", "reader"].filter((item) => !saved.includes(item))];
  });
  const [draggedPanel, setDraggedPanel] = useState<string | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const { message, showMessage, clearMessage } = useTransientMessage();
  const [loadError, setLoadError] = useState<string | null>(null);
  const configRef = useRef<AppConfig | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingConfigRef = useRef<Partial<AppConfig>>({});
  const configSaveTimerRef = useRef<number | null>(null);
  const updateVersionRef = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [editorAppearanceOpen, setEditorAppearanceOpen] = useState(false);
  const [editorAppearanceDraft, setEditorAppearanceDraft] = useState<AppConfig | null>(null);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("root");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [settingsSearchOpen, setSettingsSearchOpen] = useState(false);
  const parentPage: SettingsPage = settingsPage === "vim" ? "editor"
    : settingsPage === "sidebar" ? "appearance"
    : settingsPage === "navigation" ? "appearance"
    : ["bookmarks", "tags", "profile"].includes(settingsPage) ? "documents" : "root";
  const [syncBusy, setSyncBusy] = useState(false);
  const pushRunning = useGitHubPushJob(state => state.status === "running");
  const { confirm: confirmLeaveSync, confirmationDialog: leaveSyncDialog } = useConfirmation(open);
  const reportSyncBusy = useCallback((busy: boolean) => {
    setSyncBusy(busy);
    onSyncBusy?.(busy);
  }, [onSyncBusy]);
  const guardLeave = useCallback(async (leave: () => void) => {
    if (settingsPage === "sync" && (syncBusy || pushRunning)) {
      const accepted = await confirmLeaveSync({ title: "GitHub 同步尚未完成", description: "正在执行 Pull / Push。建议留在此页等待结果；现在返回不会取消正在进行的操作。", confirmLabel: "仍然返回" });
      if (!accepted) return;
    }
    leave();
  }, [settingsPage, syncBusy, pushRunning, confirmLeaveSync]);
  const requestClose = useCallback(() => { void guardLeave(onClose); }, [guardLeave, onClose]);
  const goBack = useCallback(() => { void guardLeave(() => {
    if (settingsPage === "root") onClose();
    else {
      setSettingsPage(parentPage);
      if (parentPage === "root" && settingsQuery.trim()) setSettingsSearchOpen(true);
    }
  }); }, [settingsPage, parentPage, settingsQuery, onClose, guardLeave]);
  const [editorAppearanceSearch, setEditorAppearanceSearch] = useState("");
  const settingsSearchRef = useRef<HTMLInputElement>(null);
  const settingsSearchButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const mobileSettingsViewport = useMobileViewport();
  const [searchDestination, setSearchDestination] = useState<SettingsSearchEntry | null>(null);
  const settingsResults = searchSettings(settingsQuery, { web: !isTauri(), updates: Boolean(webUpdate) });
  const closeSettingsSearch = () => {
    setSettingsQuery("");
    setSettingsSearchOpen(false);
    settingsSearchButtonRef.current?.focus({ preventScroll: true });
  };
  const toggleSettingsSearch = () => {
    if (settingsSearchOpen) { closeSettingsSearch(); return; }
    void guardLeave(() => {
      setSettingsPage("root");
      setSettingsSearchOpen(true);
    });
  };
  useEffect(() => {
    if (!open || !settingsSearchOpen || settingsPage !== "root") return;
    const frame = requestAnimationFrame(() => settingsSearchRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open, settingsSearchOpen, settingsPage]);
  useEffect(() => {
    if (settingsPage !== "root") setSettingsSearchOpen(false);
  }, [settingsPage]);
  const persistPanelOrder = (next: string[]) => {
    try {
      localStorage.setItem("nr:sidebarOrder", next.join(","));
      setPanelOrder(next);
      window.dispatchEvent(new Event("nr:sidebar-order-change"));
    } catch { showMessage("分栏顺序保存失败，请检查本机存储权限。"); }
  };
  const movePanel = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= panelOrder.length) return;
    const next = [...panelOrder];
    [next[index], next[target]] = [next[target], next[index]];
    persistPanelOrder(next);
  };
  useEffect(() => {
    const panel = settingsPanelRef.current;
    if (!open || !mobileSettingsViewport || !panel) return;
    return bindEdgeSwipe(panel, () => ({ direction: "right", run: goBack }), { withinPanel: true });
  }, [open, mobileSettingsViewport, goBack]);
  useEffect(() => {
    if (!searchDestination) return;
    const frame = requestAnimationFrame(() => {
      const target = searchDestination.action === "update"
        ? settingsPanelRef.current?.querySelector<HTMLElement>(".settings-update-check")
        : settingsPanelRef.current?.querySelector<HTMLElement>(searchDestination.target ?? "#settings-dialog-title");
      if (target) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "center" });
        target.classList.add("settings-search-target");
        const removeHighlight = () => target.classList.remove("settings-search-target");
        target.addEventListener("blur", removeHighlight, { once: true });
      }
      setSearchDestination(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [searchDestination]);
  const [localRendering, setLocalRendering] = useState(readonlyRenderingEnabled);
  const [rebuildingSearchIndex, setRebuildingSearchIndex] = useState(false);
  const [bookmarkNotes, setBookmarkNotes] = useState<Note[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(false);
  const [bookmarksError, setBookmarksError] = useState<string | null>(null);
  const [bookmarkReload, setBookmarkReload] = useState(0);
  const bookmarkBusyRef = useRef(false);
  const [deletingBookmarkId, setDeletingBookmarkId] = useState<string | null>(null);
  const [openingBookmark, setOpeningBookmark] = useState(false);
  const openManagedBookmark = async (noteId: string, bookmarkId: string) => {
    if (!onOpenBookmark || bookmarkBusyRef.current) return;
    bookmarkBusyRef.current = true;
    setOpeningBookmark(true);
    try { await onOpenBookmark(noteId, bookmarkId); onClose(); }
    catch (error) { setBookmarksError(`打开书签失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { bookmarkBusyRef.current = false; setOpeningBookmark(false); }
  };

  // ── 标签管理状态 ──
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const tagBusyRef = useRef(false);
  const tagsLoadedRef = useRef(false);
  const [renameTag, setRenameTag] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  // ── 导入状态 ──
  const data = useSettingsData(open, showMessage, onImport, onMarkdownImport);
  const loadSettings = () => {
    setLoading(true);
    setLoadError(null);
    withTimeout(api.config.get(), 15000, "加载设置").then((c) => {
      configRef.current = c;
      setConfig(c);
    }).catch((error) => {
      console.error("[SettingsPanel] 加载失败:", error);
      setLoadError(error instanceof Error ? error.message : String(error));
    }).finally(() => setLoading(false));
  };

  const handleSearchIndexRebuild = async () => {
    setRebuildingSearchIndex(true);
    try {
      const count = await rebuildWebSearchIndex();
      showMessage(`搜索索引已重建，共 ${count} 篇笔记`);
    } catch (error) {
      showMessage(`搜索索引重建失败，搜索仍会回退到原始数据: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRebuildingSearchIndex(false);
    }
  };


  useEffect(() => {
    clearMessage();
    if (open) {
      setSettingsPage("root");
      setSettingsQuery("");
      setSettingsSearchOpen(false);
      tagsLoadedRef.current = false;
      loadSettings();
    }
    else setEditorAppearanceOpen(false);
  }, [clearMessage, open]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => {
      const target = mobileSettingsViewport ? settingsPanelRef.current : closeButtonRef.current;
      target?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previouslyFocused?.focus();
    };
  }, [open, mobileSettingsViewport]);


  useEffect(() => {
    if (!open || settingsPage !== "bookmarks") return;
    let cancelled = false;
    setBookmarksLoading(true);
    setBookmarksError(null);
    setBookmarkNotes([]);
    Promise.allSettled([api.notes.all(), api.docs.search({})])
      .then(([dailyResult, documentsResult]) => {
        if (cancelled) return;
        if (dailyResult.status === "rejected" && documentsResult.status === "rejected") {
          throw dailyResult.reason;
        }
        if (dailyResult.status === "rejected" || documentsResult.status === "rejected") setBookmarksError("部分书签未能加载，请重试以查看完整列表。");
        const notesById = new Map<string, Note>();
        const dailyNotes = dailyResult.status === "fulfilled" ? dailyResult.value : [];
        const documents = documentsResult.status === "fulfilled" ? documentsResult.value : [];
        for (const note of [...dailyNotes, ...documents]) notesById.set(note.id, note);
        setBookmarkNotes([...notesById.values()]
          .filter((note) => (note.content.metadata?.bookmarks?.length ?? 0) > 0));
      })
      .catch((error) => {
        if (!cancelled) setBookmarksError(`加载书签失败：${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => { if (!cancelled) setBookmarksLoading(false); });
    return () => { cancelled = true; };
  }, [open, settingsPage, bookmarkReload]);

  const deleteManagedBookmark = async (note: Note, bookmarkId: string) => {
    const bookmark = note.content.metadata?.bookmarks?.find((candidate) => candidate.id === bookmarkId);
    if (bookmarkBusyRef.current || !bookmark || !window.confirm(`删除“${bookmark.label || bookmark.preview}”书签？`)) return;
    bookmarkBusyRef.current = true;
    setDeletingBookmarkId(bookmarkId);
    try {
      await onBeforeBookmarkNoteUpdate?.(note.id);
      const latestNote = await api.notes.get(note.id) ?? note;
      const nextBookmarks = (latestNote.content.metadata?.bookmarks ?? []).filter((candidate) => candidate.id !== bookmarkId);
      const currentMetadata = latestNote.content.metadata ?? {};
      const nextMetadata = nextBookmarks.length > 0
        ? { ...currentMetadata, bookmarks: nextBookmarks }
        : Object.fromEntries(Object.entries(currentMetadata).filter(([key]) => key !== "bookmarks"));
      const updated = await api.notes.update(note.id, {
        content: { ...latestNote.content, metadata: nextMetadata },
      });
      setBookmarkNotes((notes) => notes
        .map((candidate) => candidate.id === updated.id ? updated : candidate)
        .filter((candidate) => (candidate.content.metadata?.bookmarks?.length ?? 0) > 0));
      onBookmarkNoteUpdated?.(updated);
      onNotesChanged?.();
      showMessage("书签已删除");
    } catch (error) {
      showMessage(`删除书签失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      bookmarkBusyRef.current = false;
      setDeletingBookmarkId(null);
    }
  };

  const refreshTags = useCallback(() => {
    setTagsLoading(true);
    setTagsError(null);
    api.tags.listAll().then((tags) => {
      setAllTags(tags);
    }).catch((error) => {
      setTagsError(`加载标签失败：${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => {
      tagsLoadedRef.current = true;
      setTagsLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!open || settingsPage !== "tags" || tagsLoadedRef.current || tagsLoading) return;
    refreshTags();
  }, [open, refreshTags, settingsPage, tagsLoading]);

  const updateEditorAppearance = (partial: Partial<AppConfig>) => {
    setEditorAppearanceDraft((current) => {
      const base = current ?? configRef.current ?? null;
      if (!base) return null;
      return { ...base, ...partial };
    });
  };

  const applyEditorAppearance = async (display?: BlockDisplayDraft) => {
    if (!editorAppearanceDraft) return;
    const pending = {
      ...pendingConfigRef.current,
      ...pickEditorAppearanceConfig(editorAppearanceDraft),
    };
    pendingConfigRef.current = {};
    if (configSaveTimerRef.current !== null) {
      window.clearTimeout(configSaveTimerRef.current);
      configSaveTimerRef.current = null;
    }

    const saveVersion = updateVersionRef.current + 1;
    updateVersionRef.current = saveVersion;
    setSaving("editor_appearance");
    let persisted: AppConfig | null = null;
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        persisted = await saveEditorAppearance(api.config, pending, display);
      });
    try {
      await saveQueueRef.current;
      if (!persisted || saveVersion !== updateVersionRef.current) return;
      configRef.current = persisted;
      setConfig(persisted);
      onConfigChange(persisted);
      setSaving(null);
      showMessage("已更新");
      setEditorAppearanceOpen(false);
      setEditorAppearanceDraft(null);
    } catch (error) {
      if (saveVersion !== updateVersionRef.current) return;
      setSaving(null);
      // The nested panel owns errors so they remain visible with the draft.
      throw error;
    }
  };

  const closeEditorAppearance = () => {
    setEditorAppearanceOpen(false);
    setEditorAppearanceDraft(null);
  };

  const isEditorAppearanceDirty = (() => {
    if (!config || !editorAppearanceDraft) return false;
    const draft = pickEditorAppearanceConfig(editorAppearanceDraft);
    const current = pickEditorAppearanceConfig(config);
    return JSON.stringify(draft) !== JSON.stringify(current);
  })();

  const update = (partial: Partial<AppConfig>) => {
    if (!configRef.current) return;
    const key = Object.keys(partial)[0];
    updateVersionRef.current += 1;
    const optimistic = { ...configRef.current, ...partial };
    configRef.current = optimistic;
    setConfig(optimistic);
    onConfigChange(optimistic);
    setSaving(key);
    pendingConfigRef.current = { ...pendingConfigRef.current, ...partial };
    if (configSaveTimerRef.current !== null) window.clearTimeout(configSaveTimerRef.current);
    configSaveTimerRef.current = window.setTimeout(() => {
      configSaveTimerRef.current = null;
      const pending = pendingConfigRef.current;
      pendingConfigRef.current = {};
      const saveVersion = updateVersionRef.current;
      saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const merged = await api.config.set(pending);
          if (saveVersion === updateVersionRef.current) {
            const unchanged = JSON.stringify(merged) === JSON.stringify(configRef.current);
            configRef.current = merged;
            if (!unchanged) {
              setConfig(merged);
              onConfigChange(merged);
            }
            setSaving(null);
            showMessage("已更新");
          }
        } catch (error) {
          if (saveVersion === updateVersionRef.current) {
            const persisted = await api.config.get().catch(() => null);
            if (persisted) {
              configRef.current = persisted;
              setConfig(persisted);
              onConfigChange(persisted);
            }
            setSaving(null);
            showMessage(`保存失败: ${error}`);
          }
        }
      });
    }, 120);
  };

  const chk = (key: keyof AppConfig, _val: unknown) => saving === key ? "saving" : "";

  // ── 标签操作 ──
  const runTagAction = async (action: () => Promise<{ affected: number }>, verb: string) => {
    if (tagBusyRef.current) return;
    tagBusyRef.current = true;
    setTagBusy(true);
    setTagsError(null);
    try {
      const result = await action();
      showMessage(`${verb}，影响 ${result.affected} 篇文档或随笔`);
      setRenameTag(null);
      setRenameVal("");
      refreshTags();
      onNotesChanged?.();
    } catch (error) {
      setTagsError(`操作失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      tagBusyRef.current = false;
      setTagBusy(false);
    }
  };
  const handleRename = async () => {
    const target = renameVal.trim();
    if (!renameTag || !target || target === renameTag) return;
    await runTagAction(() => api.tags.rename(renameTag, target), "已重命名");
  };
  const handleMergeTag = async (name: string) => {
    if (tagBusyRef.current) return;
    const target = prompt(`将「${name}」合并到哪个标签？输入目标标签名：`)?.trim();
    if (!target || target === name) return;
    await runTagAction(() => api.tags.merge(name, target), "已合并");
  };
  const handleRemoveTag = async (name: string) => {
    if (tagBusyRef.current || !confirm(`从所有文档和随笔中移除标签「${name}」？正文不会被删除。`)) return;
    await runTagAction(() => api.tags.remove(name), "已移除标签");
  };

  // ── 导出/导入 ──

  const handleDiagnosticExport = async () => {
    if (!webStorageStatus) return;
    try {
      const report = await collectWebDiagnostics(webStorageStatus);
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `nine-rings-diagnostics-${localDateKey()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      showMessage("诊断报告已导出（不含正文、标题、标签、ID 和 Token）");
    } catch (error) {
      showMessage(`诊断报告导出失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };



  if (!open) return null;

  const expandedPanel = !mobileSettingsViewport || settingsPage !== "root";

  return (
    <div className={`settings-overlay${mobileSettingsViewport ? " settings-overlay-mobile" : ""}${expandedPanel ? " settings-expanded-overlay" : ""}`} onClick={requestClose}>
      <div
        className={`settings-panel${expandedPanel ? " settings-expanded-panel" : ""}`}
        ref={settingsPanelRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); if (settingsSearchOpen) closeSettingsSearch(); else requestClose(); } }}
      >
        <div className={`settings-header${settingsSearchOpen ? " settings-header-search-open" : ""}`}>
          <div className="settings-header-main">
            {settingsPage !== "root" && (
              <button
                className="settings-back"
                type="button"
                onClick={goBack}
                aria-label={`返回${parentPage === "root" ? "设置分类" : SETTINGS_PAGE_TITLES[parentPage]}`}
                title={`返回${parentPage === "root" ? "设置分类" : SETTINGS_PAGE_TITLES[parentPage]}`}
              >←</button>
            )}
            <h2 id="settings-dialog-title" tabIndex={-1}>{SETTINGS_PAGE_TITLES[settingsPage]}</h2>
          </div>
          <div className="settings-feedback-slot" role="status" aria-live="polite">
            {message && <div className="settings-toast"><span className="settings-feedback-text">{message}</span>
              <button type="button" className="settings-feedback-close" aria-label="关闭提示" onClick={clearMessage}><ToolbarIcon name="close" /></button>
            </div>}
          </div>
          <div className={`settings-header-search${settingsSearchOpen ? " expanded" : ""}`}>
            <div className="settings-header-search-field">
              <input
                ref={settingsSearchRef}
                type="text"
                aria-label="查找设置"
                aria-hidden={!settingsSearchOpen}
                tabIndex={settingsSearchOpen ? 0 : -1}
                placeholder="查找设置…"
                value={settingsQuery}
                onChange={event => setSettingsQuery(event.target.value)}
                onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeSettingsSearch(); } }}
              />
              {settingsSearchOpen && settingsQuery && <button type="button" className="settings-search-clear" aria-label="清除设置查找" onClick={() => { setSettingsQuery(""); settingsSearchRef.current?.focus(); }}><ToolbarIcon name="close" /></button>}
            </div>
            <button
              ref={settingsSearchButtonRef}
              type="button"
              className="settings-search-toggle"
              aria-label={settingsSearchOpen ? "收起设置查找" : "打开设置查找"}
              aria-expanded={settingsSearchOpen}
              title={settingsSearchOpen ? "收起设置查找" : "查找设置"}
              onClick={toggleSettingsSearch}
            ><ToolbarIcon name="search" /></button>
          </div>
          <button ref={closeButtonRef} className="settings-close" onClick={requestClose} aria-label="关闭设置"><ToolbarIcon name="exit" /></button>
        </div>

        {loading ? (
          <div className="settings-loading">加载中...</div>
        ) : !config ? (
          <div className="settings-loading">
            <div>设置加载失败{loadError ? `：${loadError}` : ""}</div>
            <button className="settings-retry" onClick={loadSettings}>重试</button>
          </div>
        ) : (
          <div className={`settings-body${!["root", "data", "sync"].includes(settingsPage) ? " settings-content-page" : ""}`} data-settings-page={settingsPage}>
            {libraryError && <div className="reading-library-message" role="alert">{libraryError}</div>}
            {settingsPage === "root" && settingsSearchOpen && settingsQuery.trim() && (
              <div className="settings-search-results" aria-label="设置查找结果">
                <p role="status">{settingsResults.length ? `找到 ${settingsResults.length} 项设置或说明` : "没有匹配的设置，请尝试其他关键词。"}</p>
                {settingsResults.map(result => result.action === "help"
                  ? <div key={result.title} className="settings-search-help"><strong>{result.title}</strong><p>{result.description}</p></div>
                  : <button key={result.title} className="settings-category-card" onClick={() => {
                    setSettingsSearchOpen(false);
                    setSettingsPage(result.page);
                    if (result.action === "typography") { setEditorAppearanceSearch(settingsQuery); setEditorAppearanceDraft({ ...config }); setEditorAppearanceOpen(true); }
                    else setSearchDestination(result);
                  }}><span><strong>{result.title}</strong><small>{result.description}</small></span><ToolbarIcon name="chevronRight" /></button>)}
              </div>
            )}
            {settingsPage === "root" && !settingsQuery.trim() && (
              <div key="settings-root-categories" className="settings-category-grid" aria-label="设置分类">
                {SETTINGS_CATEGORIES.map((category) => (
                  <button
                    className="settings-category-card"
                    type="button"
                    key={category.id}
                    onClick={() => setSettingsPage(category.id)}
                  >
                    <span>
                      <strong>{category.title}</strong>
                      <small>{category.description}</small>
                    </span>
                    <span className="settings-category-arrow">→</span>
                  </button>
                ))}
              </div>
            )}

            {settingsPage === "documents" && (
              <div key="settings-document-categories" className="settings-category-grid" aria-label="文档管理分类">
                <button
                  className="settings-category-card"
                  type="button"
                  onClick={() => setSettingsPage("bookmarks")}
                >
                  <span>
                    <strong>书签</strong>
                    <small>查看、使用和管理所有文档书签</small>
                  </span>
                  <span className="settings-category-arrow">→</span>
                </button>
                <button
                  className="settings-category-card"
                  type="button"
                  onClick={() => setSettingsPage("tags")}
                >
                  <span>
                    <strong>标签管理</strong>
                    <small>重命名、合并或删除标签</small>
                  </span>
                  <span className="settings-category-arrow">→</span>
                </button>
                <button className="settings-category-card" type="button" onClick={() => setSettingsPage("profile")}>
                  <span><strong>作者与文档默认值</strong><small>文档作者、组织与发布默认值</small></span>
                  <span className="settings-category-arrow">→</span>
                </button>
              </div>
            )}

            {/* ── 主题 ── */}
            <Field label="主题" desc="切换整体配色" visible={settingsPage === "appearance"}>
              <div className={mobileSettingsViewport ? "settings-radio-group settings-theme-mobile" : "settings-theme-grid"} role="group" aria-label="主题">
                {([["light", "浅", "#e2e2e2", "浅色"],
                ["dark", "深", "#0d1117", "深色"],
                ["azure-dark", "暗", "#1e3050", "暗蓝"],
                ["fu", "静", "#087e79", "静"],
                ["azure", "蔚", "#3b6dcc", "蔚"],
                ["sui", "粋", "#3d7230", "粋"],
                ["grace", "雅", "#7654b3", "雅"],
                ["zhi", "幟", "#916d22", "幟"],
                ["nord", "北境", "#434c5e", "Nord · 北境"],
                ["dracula", "德古拉", "#44475a", "Dracula · 德古拉"]] as const).map(([v, label, background, name]) => (
                  <button
                    key={v}
                    type="button"
                    className={`${mobileSettingsViewport ? `settings-radio ${config.theme === v ? "active" : ""}` : "settings-theme-option"} ${chk("theme", v)}`}
                    style={mobileSettingsViewport ? undefined : { backgroundColor: background, color: v === "light" ? "#1f2328" : "#ffffff" }}
                    title={name}
                    aria-pressed={config.theme === v}
                    onClick={() => update({ theme: v })}
                  >
                    {mobileSettingsViewport && <span className="theme-swatch" style={{ backgroundColor: background }} aria-hidden="true" />}
                    <span className="theme-label">{label}</span>
                  </button>
                ))}
              </div>
            </Field>

            <Field label="编辑器排版" desc="集中调整字体、行距、缩进和搜索高亮" visible={settingsPage === "editor"}>
              <button
                className="editor-appearance-entry"
                type="button"
                onClick={() => {
                  if (config) setEditorAppearanceDraft({ ...config });
                  setEditorAppearanceSearch("");
                  setEditorAppearanceOpen(true);
                }}
              >
                <span>
                  <strong>{config.note_font_size}px</strong>
                  <small>{config.editor_font_family === "system" ? "系统字体" : config.editor_font_family} · {config.editor_line_height.toFixed(1)} 行距</small>
                </span>
                <span className="editor-appearance-entry-action">打开排版设置 →</span>
              </button>
            </Field>

            <Field label="代码块 Vim" desc="仅在代码块独立编辑弹层中使用 Vim 键位" visible={settingsPage === "editor"}>
              <button className="editor-appearance-entry" type="button" onClick={() => setSettingsPage("vim")}>
                <span>
                  <strong>Vim 设置</strong>
                  <small>代码块 Vim 开关与 Tab 显示宽度</small>
                </span>
                <span className="editor-appearance-entry-action">打开 Vim 设置 →</span>
              </button>
            </Field>

            <Field label="布局设置" desc="调整分栏位置、阅读面板排列、顺序与宽度" visible={settingsPage === "appearance"}>
              <button className="editor-appearance-entry" type="button" onClick={() => setSettingsPage("sidebar")}>
                <span>
                  <strong>布局设置</strong>
                  <small>左右布局、目录与书签排列、浮层或并排显示</small>
                </span>
                <span className="editor-appearance-entry-action">打开布局设置 →</span>
              </button>
            </Field>

            <Field label="导航区样式" desc="分别调整目录、书签、文件树和文件列表的字体与颜色；后续可导出为外观配置" visible={settingsPage === "appearance"}>
              <button className="editor-appearance-entry" type="button" onClick={() => setSettingsPage("navigation")}><span><strong>导航区样式</strong><small>目录、书签、文件树和文件列表分别设置</small></span><span className="editor-appearance-entry-action">打开详细设置 →</span></button>
            </Field>

            {settingsPage === "navigation" && <SettingsSection title="导航区样式" desc="分别调整目录、书签、文件树和文件列表；设置会即时应用，未来可导出为外观配置。" visible>
              <div className="navigation-style-settings-detail">
                {([
                  ["目录", "navigation_outline"], ["书签", "navigation_bookmark"],
                  ["文件树", "navigation_tree"], ["文件列表", "navigation_list"],
                ] as const).map(([label, prefix]) => <fieldset key={prefix} className="navigation-style-card"><legend>{label}</legend>
                  <label>字号 <input type="range" min="11" max="22" value={config[`${prefix}_font_size` as keyof AppConfig] as number} onChange={event => update({ [`${prefix}_font_size`]: Number(event.target.value) } as Partial<AppConfig>)} /><output>{config[`${prefix}_font_size` as keyof AppConfig] as number}px</output></label>
                  <label>文字颜色 <input type="color" value={config[`${prefix}_text_color` as keyof AppConfig] as string} onChange={event => update({ [`${prefix}_text_color`]: event.target.value } as Partial<AppConfig>)} /></label>
                  <label>背景颜色 <input type="color" value={config[`${prefix}_background_color` as keyof AppConfig] as string} onChange={event => update({ [`${prefix}_background_color`]: event.target.value } as Partial<AppConfig>)} /></label>
                </fieldset>)}
              </div>
            </SettingsSection>}

            {settingsPage === "sidebar" && <div className="sidebar-settings-page">
              <SettingsWorkspaceLayout onError={showMessage} />
              <SettingsSidebarPresentation onError={showMessage} />
              <div className="sidebar-settings-intro">
                <strong>工作区分栏</strong>
                <span>拖动项目调整显示顺序；分隔条调整后的宽度会自动记住。</span>
              </div>
              <div className="sidebar-settings-card">
                <div className="sidebar-settings-card-heading">
                  <div><strong>显示顺序</strong><span>拖动排序，或用上下按钮调整</span></div>
                  <span className="sidebar-settings-count">{panelOrder.length} 个分栏</span>
                </div>
                <div className="sidebar-panel-order" aria-label="分栏显示顺序">
                  {panelOrder.map((panel, index) => (
                    <div key={panel} className="sidebar-panel-order-item" draggable onDragEnd={() => setDraggedPanel(null)} onDragStart={() => setDraggedPanel(panel)} onDragOver={(event) => event.preventDefault()} onDrop={() => {
                      if (!draggedPanel || draggedPanel === panel) return;
                      const next = [...panelOrder];
                      next.splice(next.indexOf(draggedPanel), 1);
                      next.splice(index, 0, draggedPanel);
                      persistPanelOrder(next);
                      setDraggedPanel(null);
                    }}>
                      <span className="sidebar-panel-order-position">{String(index + 1).padStart(2, "0")}</span>
                      <span className="sidebar-panel-order-label">{panel === "tree" ? "文档树" : panel === "list" ? "文档列表" : "PDF / EPUB 阅读"}</span>
                      <span className="sidebar-panel-order-actions">
                        <button type="button" className="sidebar-panel-order-button" disabled={index === 0} onClick={() => movePanel(index, -1)} aria-label={`将${panel === "tree" ? "文档树" : panel === "list" ? "文档列表" : "PDF / EPUB 阅读"}上移`} title="上移">↑</button>
                        <button type="button" className="sidebar-panel-order-button" disabled={index === panelOrder.length - 1} onClick={() => movePanel(index, 1)} aria-label={`将${panel === "tree" ? "文档树" : panel === "list" ? "文档列表" : "PDF / EPUB 阅读"}下移`} title="下移">↓</button>
                        <span className="sidebar-panel-order-grip" aria-label="拖动排序" title="拖动排序">⠿</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="sidebar-width-reset-card">
                <div><strong>分栏宽度</strong><span>恢复文档树、文档列表和阅读分栏的默认宽度</span></div>
                <button type="button" className="settings-btn settings-btn-compact" onClick={() => window.dispatchEvent(new Event("nr:reset-sidebar-widths"))}>恢复默认</button>
              </div>
            </div>}

            {/* ── 默认视图 ── */}
            <Field label="默认视图" desc="打开应用时的默认布局" visible={DAILY_NOTES_ENABLED && settingsPage === "general"}>
              <div className="settings-radio-group">
                {([["daily", "每日聚合"], ["list", "全部列表"]] as const).map(([v, label]) => (
                  <button
                    key={v}
                    className={`settings-radio ${config.default_view === v ? "active" : ""} ${chk("default_view", v)}`}
                    aria-pressed={config.default_view === v}
                    onClick={() => {
                      localStorage.setItem("nr:defaultViewConfigured", "1");
                      update({ default_view: v });
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>

            {/* ── 待办跨日继承 ── */}
            <Field label="待办跨日继承" desc="新每日页默认从未完成项继承待办" visible={TODOS_ENABLED && settingsPage === "general"}>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  aria-label="待办跨日继承" checked={config.todo_carryover_default}
                  onChange={(e) => update({ todo_carryover_default: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-label">{config.todo_carryover_default ? "开" : "关"}</span>
              </label>
            </Field>

            {/* ── 高亮当前行 ── */}
            <Field label="高亮当前行" desc="编辑器光标所在行显示浅色背景" visible={settingsPage === "editor"}>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  aria-label="高亮当前行" checked={config.highlight_active_line}
                  onChange={(e) => update({ highlight_active_line: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-label">{config.highlight_active_line ? "开" : "关"}</span>
              </label>
            </Field>

            {/* ── 显示块编号 ── */}
            <Field label="显示块编号" desc="按顶层段落、列表、图片等内容块编号" visible={settingsPage === "editor"}>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  aria-label="显示块编号" checked={config.editor_show_line_numbers}
                  onChange={(e) => update({ editor_show_line_numbers: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-label">{config.editor_show_line_numbers ? "开" : "关"}</span>
              </label>
            </Field>

            <Field label="状态栏块号" desc={config.editor_show_status_bar ? "显示光标所在的顶层块编号；与正文左侧块号使用同一套编号" : "请先开启状态栏；此选项的当前设置会保留"} visible={settingsPage === "editor"}>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  aria-label="状态栏块号" checked={config.editor_show_status_block_number}
                  disabled={!config.editor_show_status_bar}
                  onChange={(e) => update({ editor_show_status_block_number: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-label">{config.editor_show_status_block_number ? "开" : "关"}</span>
              </label>
            </Field>

            <Field label="编辑器状态栏" desc="显示底部位置、字数、版本历史和调试入口；关闭后搜索导航仍会按需出现" visible={settingsPage === "editor"}>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  aria-label="编辑器状态栏" checked={config.editor_show_status_bar}
                  onChange={(e) => update({ editor_show_status_bar: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-label">{config.editor_show_status_bar ? "开" : "关"}</span>
              </label>
            </Field>

            <Field label="只读文档双击标题折叠" desc="专注模式下，双击标题或正文可折叠所属章节（桌面端与手机安装版）" visible={settingsPage === "editor"}>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  aria-label="只读文档双击标题折叠" checked={config.editor_readonly_heading_fold}
                  onChange={(e) => update({ editor_readonly_heading_fold: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-label">{config.editor_readonly_heading_fold ? "开" : "关"}</span>
              </label>
            </Field>

            <Field label="代码块 Vim 模式（实验性）" desc="仅在代码块独立编辑弹层中启用：i 进入输入，Esc 返回 Normal，v 选择，u 撤销。关闭后直接输入；正文和引用块始终使用普通编辑。" visible={settingsPage === "vim"}>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  aria-label="代码块 Vim 模式（实验性）" checked={config.editor_vim_mode}
                  onChange={(e) => update({ editor_vim_mode: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-label">{config.editor_vim_mode ? "开" : "关"}</span>
              </label>
            </Field>

            <Field label="代码块 Tab 显示" desc="与编辑器排版中的 Tab 宽度共用，立即应用于正文代码块和块模式；不替换原有字符。" visible={settingsPage === "vim"}>
              <div className="vim-config-card">
                <div className="vim-config-card-heading"><strong>代码块与块模式</strong><span>Tab 缩进 · Shift+Tab 减少缩进</span></div>
                <div className="vim-config-grid">
                  <label>Tab 宽度<select value={Math.max(1, Math.min(16, Number(vimConfig.match(/tabstop=(\d+)/)?.[1] ?? 4)))} onChange={(event) => {
                    const next = [...normalizeVimConfig(vimConfig).split("\n").filter(line => line && !/^set tabstop(?:=|$)/.test(line)), `set tabstop=${event.target.value}`].join("\n");
                    saveVimConfig(next);
                  }}>{Array.from({ length: 16 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
                </div>
                <details><summary className="disclosure-summary"><DisclosureIcon />高级 set 配置</summary><textarea className="settings-input vim-config-editor" value={vimConfig} spellCheck={false} aria-label="Vim set 配置" onChange={(event) => { saveVimConfig(event.target.value); }} onBlur={() => { const next = normalizeVimConfig(vimConfig); saveVimConfig(next); }} rows={5} /><div className="settings-hint">当前仅应用 tabstop（1–16）；其他 set 行只保留，不会生效。代码行号与换行请在编辑器排版中设置。</div></details>
              </div>
            </Field>

            <SettingsSection title="使用方法" desc="书签随文档和备份保存；只读文档也可以查看和跳转" visible={settingsPage === "bookmarks"}>
              <div className="bookmark-help">
                <p><strong>添加：</strong>把光标放到目标位置，点击标题旁“书签”后选择“添加当前位置书签”；也可从工具栏“更多”、正文右键菜单添加，或按 <kbd>{/Mac/i.test(navigator.platform) ? "⌘" : "Ctrl"}</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> 切换当前位置书签。</p>
                <p><strong>删除：</strong>在当前文档书签面板点击 ×，或在下方集中管理列表中删除。</p>
                <p><strong>专注模式：</strong>使用顶部“书签”按钮打开当前文档的书签列表。</p>
              </div>
            </SettingsSection>

            <SettingsSection title="所有书签" desc="点击书签打开所属文档并定位；右侧 × 仅删除书签" visible={settingsPage === "bookmarks"}>
              {bookmarksError && <div className="settings-error-state" role="alert"><p>{bookmarksError}</p><button type="button" className="settings-btn-secondary" disabled={bookmarksLoading} onClick={() => setBookmarkReload(value => value + 1)}>重新加载书签</button></div>}
              {bookmarksLoading ? (
                <div className="settings-loading-inline">正在加载书签…</div>
              ) : bookmarkNotes.length === 0 && !bookmarksError ? (
                <div className="settings-empty-state">还没有书签</div>
              ) : (
                <div className="bookmark-manager-list">
                  {bookmarkNotes.map((note) => (
                    <section className="bookmark-manager-note" key={note.id}>
                      <h3>{note.title || "无标题"}</h3>
                      {(note.content.metadata?.bookmarks ?? []).map((bookmark, index) => (
                        <div className="bookmark-manager-item" key={bookmark.id}>
                          <span className="bookmark-manager-index">{bookmark.key ? `'${bookmark.key}` : index + 1}</span>
                          <button type="button" className="bookmark-manager-label bookmark-manager-link" title={bookmark.preview}
                            disabled={openingBookmark || deletingBookmarkId !== null || !onOpenBookmark}
                            onClick={() => void openManagedBookmark(note.id, bookmark.id)}>{bookmark.label || bookmark.preview}</button>
                          <button
                            type="button"
                            disabled={openingBookmark || deletingBookmarkId !== null}
                            onClick={() => void deleteManagedBookmark(note, bookmark.id)}
                            aria-label={`删除书签 ${bookmark.label || bookmark.preview}`}
                            title="删除书签"
                          >×</button>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              )}
            </SettingsSection>

            {/* ── 正文右键菜单 ── */}
            <Field label="正文右键菜单" desc="开启后正文编辑器使用软件自带菜单，关闭则使用系统原生菜单" visible={settingsPage === "editor"}>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  aria-label="正文右键菜单" checked={config.use_custom_context_menu}
                  onChange={(e) => update({ use_custom_context_menu: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-label">{config.use_custom_context_menu ? "软件菜单" : "原生菜单"}</span>
              </label>
            </Field>

            <Field label="折叠标识" desc="用于文本区标题、代码／引用块和文档目录；即时生效，不修改正文" visible={settingsPage === "editor"}>
              <SettingsFoldIcons config={config} onChange={update} />
            </Field>

            {/* ═══════════════════════ */}
            {/* 快捷键 */}
            {/* ═══════════════════════ */}
            <SettingsSection title="快捷键" desc="点击快捷键录制新组合，Esc 取消；设置用于桌面版全局热键。" visible={settingsPage === "general"}>
              <HotkeyConfig
                config={config}
                onUpdate={(hk) => update({ hotkeys: hk })}
              />
            </SettingsSection>

            <SettingsSection title="作者与文档默认值" desc="用于文档属性和导出的默认信息；单篇文档可以单独设置，不会改写已有正文。" visible={settingsPage === "profile"}>
              <div className="user-profile-grid">
                <label className="settings-label">
                  <span>姓名 / 作者</span>
                  <input className="settings-input" autoComplete="name" value={config.user_name} onChange={(event) => update({ user_name: event.target.value })} placeholder="例如 张三" />
                </label>
                <label className="settings-label">
                  <span>组织</span>
                  <input className="settings-input" autoComplete="organization" value={config.user_organization} onChange={(event) => update({ user_organization: event.target.value })} placeholder="公司、团队或机构" />
                </label>
                <label className="settings-label">
                  <span>邮箱</span>
                  <input className="settings-input" type="email" autoComplete="email" value={config.user_email} onChange={(event) => update({ user_email: event.target.value })} placeholder="name@example.com" />
                </label>
                <label className="settings-label">
                  <span>网站</span>
                  <input className="settings-input" type="url" autoComplete="url" value={config.user_website} onChange={(event) => update({ user_website: event.target.value })} placeholder="https://example.com" />
                </label>
                <label className="settings-label">
                  <span>默认语言（文档）</span>
                  <input className="settings-input" value={config.user_default_language} onChange={(event) => update({ user_default_language: event.target.value })} placeholder="例如 zh-CN，不改变界面语言" />
                </label>
                <label className="settings-label">
                  <span>默认许可证</span>
                  <input className="settings-input" value={config.user_default_license} onChange={(event) => update({ user_default_license: event.target.value })} placeholder="例如 CC BY 4.0" />
                </label>
                <label className="settings-label user-profile-wide">
                  <span>默认版权声明</span>
                  <input className="settings-input" value={config.user_copyright} onChange={(event) => update({ user_copyright: event.target.value })} placeholder="例如 © 2026 作者，保留所有权利" />
                </label>
              </div>
              <p className="settings-hint">这些信息属于普通配置，会随全量备份迁移；GitHub Token 等敏感凭据仍会被排除。</p>
            </SettingsSection>

            {/* ═══════════════════════ */}
            {/* 标签管理 */}
            {/* ═══════════════════════ */}
            <SettingsSection title="标签管理" desc="管理文档和随笔的普通标签；移除标签不会删除正文。概念标签在文档属性中管理。" visible={settingsPage === "tags"}>

              {tagsError && <div className="settings-error-state" role="alert"><p>{tagsError}</p><button type="button" className="settings-btn-secondary" disabled={tagsLoading || tagBusy} onClick={refreshTags}>重新加载标签</button></div>}
              {/* 重命名输入框 */}
              {renameTag && (
                <div className="settings-inline-edit">
                  <span className="settings-inline-label">重命名「{renameTag}」→</span>
                  <input
                    className="settings-input"
                    aria-label="新标签名" disabled={tagBusy}
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void handleRename(); }
                      if (e.key === "Escape") { e.stopPropagation(); setRenameTag(null); setRenameVal(""); }
                    }}
                    autoFocus
                    placeholder="新标签名"
                  />
                  <button className="settings-sm-btn" disabled={tagBusy || !renameVal.trim() || renameVal.trim() === renameTag} onClick={() => void handleRename()}>{tagBusy ? "保存中…" : "确认"}</button>
                  <button className="settings-sm-btn" disabled={tagBusy} onClick={() => { setRenameTag(null); setRenameVal(""); }}>取消</button>
                </div>
              )}

              {/* 标签列表 */}
              {tagsLoading ? (
                <div className="settings-empty">正在加载标签…</div>
              ) : allTags.length === 0 && !tagsError ? (
                <div className="settings-empty">暂无标签</div>
              ) : (
                <div className="settings-tag-list">
                  {allTags.map((t) => (
                    <div key={t} className="settings-tag-row">
                      <span className="settings-tag-name">{t}</span>
                      <div className="settings-tag-actions">
                        <button
                          className="settings-sm-btn"
                          onClick={() => { setRenameTag(t); setRenameVal(t); }}
                          disabled={tagBusy || tagsLoading} aria-label={`重命名标签 ${t}`}
                          title="重命名"
                        >✎</button>
                        <button
                          className="settings-sm-btn"
                          onClick={() => void handleMergeTag(t)}
                          disabled={tagBusy || tagsLoading} aria-label={`合并标签 ${t}`}
                          title="合并到其他标签"
                        >⊕</button>
                        <button
                          className="settings-sm-btn danger"
                          onClick={() => handleRemoveTag(t)}
                          disabled={tagBusy || tagsLoading} aria-label={`删除标签 ${t}`}
                          title="删除标签"
                        >×</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SettingsSection>



            {/* ═══════════════════════ */}
            {/* 数据导出/导入 */}
            {/* ═══════════════════════ */}

            <SettingsDataPage visible={settingsPage === "data"} webStorageStatus={webStorageStatus} data={data} />
            {/* GitHub 备份 */}
            {/* ═══════════════════════ */}
            {settingsPage === "sync" && (
              <SettingsSync onBusyChange={reportSyncBusy} onBeforePush={onBeforePush} onPullDone={onPullDone} />
            )}

            <Field label="只读正文局部渲染（实验）" desc="默认关闭，仅本设备生效。只读时按可见区域挂载正文；图片、表格及超大单块自动回退。跨全文选择、打印、书签管理请切回完整渲染。" visible={settingsPage === "advanced"}>
              <label className="settings-toggle">
                <input type="checkbox" aria-label="只读正文局部渲染（实验）" checked={localRendering} onChange={event => {
                  try { setReadonlyRenderingEnabled(event.target.checked); setLocalRendering(event.target.checked); }
                  catch { showMessage("无法保存本地实验设置"); }
                }} />
                <span className="toggle-track" /><span className="toggle-label">{localRendering ? "开" : "关"}</span>
              </label>
            </Field>

            {/* ── 回收站自动清理：设置项末尾 ── */}
            <Field label="回收站自动清理" desc="打开应用或修改此设置时，永久清理已在回收站超过指定天数的内容。设为 0 关闭自动清理。" visible={settingsPage === "advanced"}>
              <div className="settings-stepper">
                <button
                  className="settings-step-btn"
                  aria-label="减少回收站保留天数" disabled={config.auto_clean_days === 0}
                  onClick={() => update({ auto_clean_days: Math.max(0, config.auto_clean_days - 7) })}
                >−</button>
                <span className={`settings-value ${chk("auto_clean_days", 0)}`}>
                  {config.auto_clean_days === 0 ? "关闭" : `${config.auto_clean_days} 天`}
                </span>
                <button
                  className="settings-step-btn"
                  aria-label="增加回收站保留天数" disabled={config.auto_clean_days >= 365}
                  onClick={() => update({ auto_clean_days: Math.min(365, config.auto_clean_days + 7) })}
                >+</button>
              </div>
            </Field>

            {!isTauri() && (
              <Field label="Web 搜索索引" desc="搜索结果不完整时可尝试重建；仅更新搜索索引，不修改正文。" visible={settingsPage === "advanced"}>
                <button
                  className="settings-btn-secondary"
                  type="button"
                  disabled={rebuildingSearchIndex}
                  onClick={() => void handleSearchIndexRebuild()}
                >
                  {rebuildingSearchIndex ? "正在重建…" : "重建搜索索引"}
                </button>
              </Field>
            )}

            {!isTauri() && settingsPage === "advanced" && webStorageStatus && (
              <SettingsSection title="本地诊断" desc="生成仅保存在本机的脱敏问题排查报告">
                <p className="settings-hint">
                  导出运行环境、存储配额和数据数量，便于排查 Web/PWA 问题。报告不包含正文、标题、标签、笔记 ID 或 GitHub Token。
                </p>
                <button className="settings-btn-secondary" type="button" onClick={() => void handleDiagnosticExport()}>
                  导出诊断报告
                </button>
              </SettingsSection>
            )}


            {settingsPage === "changelog" && <SettingsChangelog />}

            {/* ── 版本 ── */}
            {settingsPage === "root" && (
              <>
                <div className="settings-version">v{__APP_VERSION__}</div>
                {webUpdate && <SettingsUpdateStatus webUpdate={webUpdate} showMessage={showMessage} />}
              </>
            )}
          </div>
        )}
      </div>
      {leaveSyncDialog}
      {editorAppearanceOpen && config && (
        <EditorAppearancePanel
          initialSearch={editorAppearanceSearch}
          config={editorAppearanceDraft ?? config}
          onClose={closeEditorAppearance}
          onUpdate={updateEditorAppearance}
          onApply={applyEditorAppearance}
          dirty={isEditorAppearanceDirty}
        />
      )}
    </div>
  );
}
