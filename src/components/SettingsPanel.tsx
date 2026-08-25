import React, { useCallback, useEffect, useState, useRef } from "react";
import { api } from "../lib/api";
import { localDateKey } from "../lib/local-date";
import type { AppConfig, DocType, Note } from "../types/models";
import { DEFAULT_HOTKEYS, HOTKEY_LABELS } from "../types/models";
import { parseMetadataList } from "../lib/markdown-import";
import { transformMarkdownBatch } from "../lib/data-transform-client";
import { isTauri, exportWithDialog, importWithDialog } from "../lib/tauri-desktop";
import SettingsSync from "./SettingsSync";
import { withTimeout } from "../lib/async";
import { EditorAppearancePanel } from "./EditorAppearancePanel";
import { isDocumentFindShortcut, isEditorLineJumpShortcut } from "../lib/shortcuts";
import type { WebStorageStatus } from "../hooks/useWebPlatform";
import { collectWebDiagnostics } from "../lib/web-diagnostics";
import { rebuildWebSearchIndex } from "../lib/web-search-index";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfigChange: (config: AppConfig) => void;
  onImport?: () => void;
  /** 同步进行中回调 — 用来 freeze 编辑区 */
  onSyncBusy?: (busy: boolean) => void;
  /** Pull 完成后回调 — 重新载入并应用恢复后的设置与工作区 */
  onPullDone?: () => void;
  webStorageStatus?: WebStorageStatus;
  onBeforeBookmarkNoteUpdate?: (noteId: string) => Promise<void>;
  onBookmarkNoteUpdated?: (note: Note) => void;
}

type SettingsPage = "root" | "appearance" | "editor" | "bookmarks" | "general" | "profile" | "tags" | "data" | "sync" | "advanced";
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
  { id: "appearance", title: "外观与排版", description: "主题、字体、字号与内容间距" },
  { id: "editor", title: "编辑器", description: "Vim、书签、块编号、状态栏与右键菜单" },
  { id: "bookmarks", title: "书签", description: "查看、使用和管理所有文档书签" },
  { id: "general", title: "工作流与快捷键", description: "默认视图、待办继承和按键绑定" },
  { id: "profile", title: "用户信息", description: "文档作者、组织与发布默认值" },
  { id: "data", title: "数据与导入", description: "JSON 备份及 Markdown 批量导入" },
  { id: "tags", title: "标签管理", description: "重命名、合并或删除标签" },
  { id: "sync", title: "同步与备份", description: "GitHub 仓库和同步操作" },
  { id: "advanced", title: "高级", description: "回收站策略与开发服务端口" },
];

const SETTINGS_PAGE_TITLES: Record<SettingsPage, string> = {
  root: "设置",
  appearance: "外观与排版",
  editor: "编辑器",
  bookmarks: "书签",
  general: "工作流与快捷键",
  profile: "用户信息",
  tags: "标签管理",
  data: "数据与导入",
  sync: "同步与备份",
  advanced: "高级",
};

const MD_IMPORT_CHUNK_SIZE = 4;

function yieldToNextFrame(): Promise<void> {
  if (typeof window === "undefined") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

export function SettingsPanel({ open, onClose, onConfigChange, onImport, onSyncBusy, onPullDone, webStorageStatus, onBeforeBookmarkNoteUpdate, onBookmarkNoteUpdated }: Props) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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
  const [rebuildingSearchIndex, setRebuildingSearchIndex] = useState(false);
  const [bookmarkNotes, setBookmarkNotes] = useState<Note[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(false);
  const [deletingBookmarkId, setDeletingBookmarkId] = useState<string | null>(null);

  // ── 标签管理状态 ──
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const tagsLoadedRef = useRef(false);
  const [renameTag, setRenameTag] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  // ── 导入状态 ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  // ── Markdown 导入状态 ──
  const mdInputRef = useRef<HTMLInputElement>(null);
  const [mdImporting, setMdImporting] = useState(false);
  const [mdImportCount, setMdImportCount] = useState(0);
  const [mdImportTotal, setMdImportTotal] = useState(0);
  const [mdImportProgress, setMdImportProgress] = useState(0);
  const [mdImportCurrentFile, setMdImportCurrentFile] = useState("");
  const [mdImportMode, setMdImportMode] = useState<"document" | "note">("document");
  const [mdImportPath, setMdImportPath] = useState("references/imported");
  const [mdImportDocType, setMdImportDocType] = useState<DocType>("reference");
  const [mdImportTags, setMdImportTags] = useState("");
  const [mdImportConcepts, setMdImportConcepts] = useState("");

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
      setMessage(`搜索索引已重建，共 ${count} 篇笔记`);
    } catch (error) {
      setMessage(`搜索索引重建失败，搜索仍会回退到原始数据: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRebuildingSearchIndex(false);
    }
  };

  useEffect(() => {
    if (open) {
      setSettingsPage("root");
      tagsLoadedRef.current = false;
      loadSettings();
    }
    else setEditorAppearanceOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previouslyFocused?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || settingsPage !== "bookmarks") return;
    let cancelled = false;
    setBookmarksLoading(true);
    Promise.allSettled([api.notes.all(), api.docs.search({})])
      .then(([dailyResult, documentsResult]) => {
        if (cancelled) return;
        if (dailyResult.status === "rejected" && documentsResult.status === "rejected") {
          throw dailyResult.reason;
        }
        const notesById = new Map<string, Note>();
        const dailyNotes = dailyResult.status === "fulfilled" ? dailyResult.value : [];
        const documents = documentsResult.status === "fulfilled" ? documentsResult.value : [];
        for (const note of [...dailyNotes, ...documents]) notesById.set(note.id, note);
        setBookmarkNotes([...notesById.values()]
          .filter((note) => (note.content.metadata?.bookmarks?.length ?? 0) > 0));
      })
      .catch((error) => {
        if (!cancelled) setMessage(`加载书签失败：${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => { if (!cancelled) setBookmarksLoading(false); });
    return () => { cancelled = true; };
  }, [open, settingsPage]);

  const deleteManagedBookmark = async (note: Note, bookmarkId: string) => {
    const bookmark = note.content.metadata?.bookmarks?.find((candidate) => candidate.id === bookmarkId);
    if (!bookmark || !window.confirm(`删除“${bookmark.label || bookmark.preview}”书签？`)) return;
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
      setMessage("书签已删除");
    } catch (error) {
      setMessage(`删除书签失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDeletingBookmarkId(null);
    }
  };

  const refreshTags = useCallback(() => {
    setTagsLoading(true);
    api.tags.listAll().then((tags) => {
      setAllTags(tags);
    }).catch(() => {}).finally(() => {
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

  const applyEditorAppearance = () => {
    if (!editorAppearanceDraft) return;
    update(editorAppearanceDraft);
    setEditorAppearanceOpen(false);
    setEditorAppearanceDraft(null);
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
            setMessage("已更新");
            setTimeout(() => setMessage(null), 1500);
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
            setMessage(`保存失败: ${error}`);
          }
        }
      });
    }, 120);
  };

  const chk = (key: keyof AppConfig, _val: any) => saving === key ? "saving" : "";

  // ── 标签操作 ──
  const handleRename = async () => {
    if (!renameTag || !renameVal.trim()) return;
    const result = await api.tags.rename(renameTag, renameVal.trim());
    setMessage(`已重命名，影响 ${result.affected} 篇笔记`);
    setRenameTag(null);
    setRenameVal("");
    refreshTags();
    setTimeout(() => setMessage(null), 2000);
  };

  const handleRemoveTag = async (name: string) => {
    if (!confirm(`确认从所有笔记中移除标签「${name}」？`)) return;
    const result = await api.tags.remove(name);
    setMessage(`已移除，影响 ${result.affected} 篇笔记`);
    refreshTags();
    setTimeout(() => setMessage(null), 2000);
  };

  // ── 导出/导入 ──
  const handleExport = async () => {
    try {
      const data = await api.export.data();
      if (isTauri()) {
        const path = await exportWithDialog(data);
        if (path) {
          setMessage(`已保存到 ${path}`);
        }
        // 用户取消则不显示任何消息
      } else {
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `nine-rings-${localDateKey()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setMessage("导出成功");
      }
      setTimeout(() => setMessage(null), 2000);
    } catch (e) {
      setMessage(`导出失败: ${e}`);
    }
  };

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
      setMessage("诊断报告已导出（不含正文、标题、标签、ID 和 Token）");
    } catch (error) {
      setMessage(`诊断报告导出失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      if (isTauri()) {
        const text = await importWithDialog();
        if (text) {
          const result = await api.export.import(text);
          const configTip = result.configs_imported ? "，配置已恢复" : "";
          setMessage(`导入完成：${result.notes_imported} 篇笔记, ${result.pages_imported} 个页面${configTip}`);
          onImport?.();
        }
      } else {
        // Web 模式：触发隐藏的 file input
        fileInputRef.current?.click();
        return; // 后续由 handleImportFile 处理
      }
    } catch (e) {
      setMessage(`导入失败: ${e}`);
    } finally {
      setImporting(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  /// Web 模式的 file input 回调（Tauri 模式不走这里）
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const result = await api.export.import(text);
      const configTip = result.configs_imported ? "，配置已恢复" : "";
      setMessage(`导入完成：${result.notes_imported} 篇笔记, ${result.pages_imported} 个页面${configTip}`);
      onImport?.();
      e.target.value = "";
    } catch (e) {
      setMessage(`导入失败: ${e}`);
    } finally {
      setImporting(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  // ── Markdown 导入 ──
  const handleMdImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setMdImporting(true);
    setMdImportCount(0);
    setMdImportTotal(files.length);
    setMdImportProgress(0);
    setMdImportCurrentFile("");
    const today = localDateKey();
    let count = 0;
    const failures: string[] = [];
    try {
      const fileList = [...files];
      const sources = await Promise.all(fileList.map(async (file) => ({
        fileName: file.name,
        source: await file.text(),
      })));
      const transformed = await transformMarkdownBatch(sources, {
        date: today,
        mode: mdImportMode,
        storagePath: mdImportPath,
        docType: mdImportDocType,
        tags: parseMetadataList(mdImportTags),
        concepts: parseMetadataList(mdImportConcepts),
      });
      for (let fi = 0; fi < transformed.length; fi++) {
        const result = transformed[fi];
        setMdImportCurrentFile(result.fileName);
        try {
          if (!result.input) throw new Error(result.error ?? "Markdown 转换失败");
          await api.notes.create(result.input);
          count++;
        } catch (error) {
          failures.push(`${result.fileName}: ${error instanceof Error ? error.message : String(error)}`);
        }
        setMdImportProgress(fi + 1);
        if ((fi + 1) % MD_IMPORT_CHUNK_SIZE === 0) {
          await yieldToNextFrame();
        }
      }
      setMdImportCount(count);
      if (count > 0) onImport?.();
      setMessage(failures.length > 0
        ? `已导入 ${count} 篇，失败 ${failures.length} 篇：${failures[0]}`
        : `Markdown 导入完成：${count} 篇${mdImportMode === "document" ? `，路径 ${mdImportPath}` : ""}`);
    } catch (err) {
      setMessage(`导入失败: ${err}`);
    } finally {
      setMdImporting(false);
      setMdImportCurrentFile("");
      setMdImportTotal(0);
      setMdImportProgress(0);
      // 无论成功失败都允许再次选择同一批文件。
      e.target.value = "";
    }
  };

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
      >
        <div className="settings-header">
          <div className="settings-header-main">
            {settingsPage !== "root" && (
              <button
                className="settings-back"
                type="button"
                onClick={() => setSettingsPage("root")}
                aria-label="返回设置分类"
                title="返回设置分类"
              >←</button>
            )}
            <h2 id="settings-dialog-title">{SETTINGS_PAGE_TITLES[settingsPage]}</h2>
          </div>
          <button ref={closeButtonRef} className="settings-close" onClick={onClose} aria-label="关闭设置">✕</button>
        </div>

        {loading ? (
          <div className="settings-loading">加载中...</div>
        ) : !config ? (
          <div className="settings-loading">
            <div>设置加载失败{loadError ? `：${loadError}` : ""}</div>
            <button className="settings-retry" onClick={loadSettings}>重试</button>
          </div>
        ) : (
          <div className="settings-body">
            {settingsPage === "root" && (
              <div className="settings-category-grid" aria-label="设置分类">
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

            {/* ── 主题 ── */}
            <Field label="主题" desc="切换整体配色" visible={settingsPage === "appearance"}>
              <div className="settings-radio-group">
                {([["light", "浅", "#e2e2e2"],
                ["dark", "深", "#0d1117"],
                ["azure-dark", "暗", "#1e3050"],
                ["fu", "静", "#81D8D0"],
                ["azure", "蔚", "#3b6dcc"],
                ["sui", "粋", "#4a8a3a"],
                ["grace", "雅", "#7654b3"],
                ["zhi", "幟", "#c49a3c"]] as const).map(([v, label, color]) => (
                  <button
                    key={v}
                    className={`settings-radio ${config.theme === v ? "active" : ""} ${chk("theme", v)}`}
                    onClick={() => update({ theme: v })}
                  >
                    <span
                      className="theme-swatch"
                      style={{ backgroundColor: color }}
                    />
                    <span className="theme-label">{label}</span>
                  </button>
                ))}
              </div>
            </Field>

            <Field label="编辑器排版" desc="集中调整字体、行距、缩进和搜索高亮" visible={settingsPage === "appearance"}>
              <button
                className="editor-appearance-entry"
                type="button"
                onClick={() => {
                  if (config) setEditorAppearanceDraft({ ...config });
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

            {/* ── 默认视图 ── */}
            <Field label="默认视图" desc="打开应用时的默认布局" visible={settingsPage === "general"}>
              <div className="settings-radio-group">
                {([["daily", "每日聚合"], ["list", "全部列表"]] as const).map(([v, label]) => (
                  <button
                    key={v}
                    className={`settings-radio ${config.default_view === v ? "active" : ""} ${chk("default_view", v)}`}
                    onClick={() => update({ default_view: v })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>

            {/* ── 待办跨日继承 ── */}
            <Field label="待办跨日继承" desc="新每日页默认从未完成项继承待办" visible={settingsPage === "general"}>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={config.todo_carryover_default}
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
                  checked={config.highlight_active_line}
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
                  checked={config.editor_show_line_numbers}
                  onChange={(e) => update({ editor_show_line_numbers: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-label">{config.editor_show_line_numbers ? "开" : "关"}</span>
              </label>
            </Field>

            <Field label="状态栏块号" desc="显示光标所在的顶层块编号，并与正文左侧块号保持一致" visible={settingsPage === "editor"}>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={config.editor_show_status_block_number}
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
                  checked={config.editor_show_status_bar}
                  onChange={(e) => update({ editor_show_status_bar: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-label">{config.editor_show_status_bar ? "开" : "关"}</span>
              </label>
            </Field>

            <Field label="Vim 模式（实验性）" desc="Normal/Visual 优先使用 Vim 键位；i 进入输入，Esc 返回 Normal；Ctrl+F/B 整页、Ctrl+D/U 半页、Ctrl+E/Y 单行滚动" visible={settingsPage === "editor"}>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={config.editor_vim_mode}
                  onChange={(e) => update({ editor_vim_mode: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-label">{config.editor_vim_mode ? "开" : "关"}</span>
              </label>
            </Field>

            <SettingsSection title="使用方法" desc="书签随文档和备份保存；只读文档也可以查看和跳转" visible={settingsPage === "bookmarks"}>
              <div className="bookmark-help">
                <p><strong>普通模式：</strong>把光标放到目标位置，点击标题旁“书签”后选择“添加当前位置书签”；也可从工具栏“更多”、正文右键菜单添加，或按 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> 切换当前位置书签。</p>
                <p><strong>删除：</strong>在当前文档书签面板点击 ×，或在下方集中管理列表中删除。普通书签不要求开启 Vim 模式。</p>
                <p><strong>Vim 模式：</strong>Normal 模式按 <kbd>m</kbd> 后接 a–z 设置命名书签，按 <kbd>'</kbd> 后接同一字母跳转。</p>
                <p><strong>专注模式：</strong>使用顶部“书签”按钮打开当前文档的书签列表。</p>
              </div>
            </SettingsSection>

            <SettingsSection title="所有书签" desc="按文档集中查看和删除书签" visible={settingsPage === "bookmarks"}>
              {bookmarksLoading ? (
                <div className="settings-loading-inline">正在加载书签…</div>
              ) : bookmarkNotes.length === 0 ? (
                <div className="settings-empty-state">还没有书签</div>
              ) : (
                <div className="bookmark-manager-list">
                  {bookmarkNotes.map((note) => (
                    <section className="bookmark-manager-note" key={note.id}>
                      <h3>{note.title || "无标题"}</h3>
                      {(note.content.metadata?.bookmarks ?? []).map((bookmark, index) => (
                        <div className="bookmark-manager-item" key={bookmark.id}>
                          <span className="bookmark-manager-index">{bookmark.key ? `'${bookmark.key}` : index + 1}</span>
                          <span className="bookmark-manager-label" title={bookmark.preview}>{bookmark.label || bookmark.preview}</span>
                          <button
                            type="button"
                            disabled={deletingBookmarkId === bookmark.id}
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
                  checked={config.use_custom_context_menu}
                  onChange={(e) => update({ use_custom_context_menu: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-label">{config.use_custom_context_menu ? "软件菜单" : "原生菜单"}</span>
              </label>
            </Field>

            {/* ── 开发端口 ── */}
            <Field label="Dev 端口" desc="Web 开发服务器端口（需重启 dev server 生效）" visible={settingsPage === "advanced"}>
              <div className="settings-stepper">
                <button
                  className="settings-step-btn"
                  onClick={() => update({ dev_port: Math.max(1024, config.dev_port - 1) })}
                >−</button>
                <span className={`settings-value ${chk("dev_port", 0)}`}>
                  {config.dev_port}
                </span>
                <button
                  className="settings-step-btn"
                  onClick={() => update({ dev_port: Math.min(65535, config.dev_port + 1) })}
                >+</button>
              </div>
            </Field>

            {/* ═══════════════════════ */}
            {/* 快捷键 */}
            {/* ═══════════════════════ */}
            <SettingsSection title="快捷键" desc="点击快捷键后按下新组合键即可修改" visible={settingsPage === "general"}>
              <HotkeyConfig
                config={config}
                onUpdate={(hk) => update({ hotkeys: hk })}
              />
            </SettingsSection>

            <SettingsSection title="用户信息" desc="作为文档属性和 PDF 导出的默认值；单篇文档可以覆盖" visible={settingsPage === "profile"}>
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
                  <span>默认语言</span>
                  <input className="settings-input" value={config.user_default_language} onChange={(event) => update({ user_default_language: event.target.value })} placeholder="zh-CN" />
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
            <SettingsSection title="标签管理" desc="管理所有笔记中的标签" visible={settingsPage === "tags"}>

              {/* 重命名输入框 */}
              {renameTag && (
                <div className="settings-inline-edit">
                  <span className="settings-inline-label">重命名「{renameTag}」→</span>
                  <input
                    className="settings-input"
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename();
                      if (e.key === "Escape") { setRenameTag(null); setRenameVal(""); }
                    }}
                    autoFocus
                    placeholder="新标签名"
                  />
                  <button className="settings-sm-btn" onClick={handleRename}>确认</button>
                  <button className="settings-sm-btn" onClick={() => { setRenameTag(null); setRenameVal(""); }}>取消</button>
                </div>
              )}

              {/* 标签列表 */}
              {tagsLoading ? (
                <div className="settings-empty">正在加载标签…</div>
              ) : allTags.length === 0 ? (
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
                          title="重命名"
                        >✎</button>
                        <button
                          className="settings-sm-btn"
                          onClick={async () => {
                            const target = prompt(`将「${t}」合并到哪个标签？输入目标标签名：`);
                            if (!target || target === t) return;
                            const result = await api.tags.merge(t, target);
                            setMessage(`已合并，影响 ${result.affected} 篇笔记`);
                            refreshTags();
                            setTimeout(() => setMessage(null), 2000);
                          }}
                          title="合并到其他标签"
                        >⊕</button>
                        <button
                          className="settings-sm-btn danger"
                          onClick={() => handleRemoveTag(t)}
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
            {webStorageStatus?.supported && (
              <SettingsSection title="浏览器存储" desc="Nine Rings 的本地数据保存在当前浏览器中" visible={settingsPage === "data"}>
                <div className="web-storage-summary">
                  <span>
                    持久存储：
                    <strong>{webStorageStatus.persisted ? "已授权" : "未授权"}</strong>
                  </span>
                  <span>
                    已使用：
                    <strong>{formatStorageBytes(webStorageStatus.usage)}</strong>
                    {webStorageStatus.quota !== null && ` / ${formatStorageBytes(webStorageStatus.quota)}`}
                  </span>
                </div>
                {!webStorageStatus.persisted && (
                  <p className="web-storage-hint">浏览器可能在空间紧张时清理本站数据，建议定期导出或配置 GitHub 备份。</p>
                )}
              </SettingsSection>
            )}
            <SettingsSection title="数据导出 / 导入" desc="全量 JSON 包含笔记、待办、书签、应用配置及非敏感用户设置；Token、密码等凭据不导出" visible={settingsPage === "data"}>
              <div className="settings-button-row">
                <button className="settings-btn-primary" onClick={handleExport}>
                  导出数据
                </button>
                <button
                  className="settings-btn-secondary"
                  onClick={handleImport}
                  disabled={importing}
                >
                  {importing ? "导入中..." : "导入数据"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  style={{ display: "none" }}
                  onChange={handleImportFile}
                />
              </div>
            </SettingsSection>

            {/* ═══════════════════════ */}
            {/* Markdown 导入 */}
            {/* ═══════════════════════ */}
            <SettingsSection title="Markdown 导入" desc="导入一个或多个 .md 文件，并指定文档位置与元数据" visible={settingsPage === "data"}>
              <div className="markdown-import-form">
                <div className="settings-radio-group markdown-import-mode" role="radiogroup" aria-label="Markdown 导入类型">
                  <button
                    className={`settings-radio ${mdImportMode === "document" ? "active" : ""}`}
                    onClick={() => setMdImportMode("document")}
                    type="button"
                  >导入为文档</button>
                  <button
                    className={`settings-radio ${mdImportMode === "note" ? "active" : ""}`}
                    onClick={() => setMdImportMode("note")}
                    type="button"
                  >导入为随笔</button>
                </div>

                {mdImportMode === "document" && (
                  <div className="markdown-import-grid">
                    <label className="markdown-import-field markdown-import-path-field">
                      <span>目标路径</span>
                      <input
                        className="settings-input"
                        aria-label="Markdown 导入目标路径"
                        placeholder="例如 references/networking"
                        value={mdImportPath}
                        onChange={(event) => setMdImportPath(event.target.value)}
                      />
                      <small>所有选中文件将作为独立文档放入这个目录。</small>
                    </label>
                    <label className="markdown-import-field">
                      <span>文档类型</span>
                      <select
                        className="settings-input"
                        aria-label="Markdown 导入文档类型"
                        value={mdImportDocType}
                        onChange={(event) => setMdImportDocType(event.target.value as DocType)}
                      >
                        <option value="explanation">解释</option>
                        <option value="how-to">指南</option>
                        <option value="reference">参考</option>
                        <option value="tutorial">教程</option>
                      </select>
                    </label>
                    <label className="markdown-import-field">
                      <span>概念标签</span>
                      <input
                        className="settings-input"
                        aria-label="Markdown 导入概念标签"
                        placeholder="逗号分隔，可选"
                        value={mdImportConcepts}
                        onChange={(event) => setMdImportConcepts(event.target.value)}
                      />
                    </label>
                  </div>
                )}

                <label className="markdown-import-field">
                  <span>普通标签</span>
                  <input
                    className="settings-input"
                    aria-label="Markdown 导入普通标签"
                    placeholder="逗号分隔，可选"
                    value={mdImportTags}
                    onChange={(event) => setMdImportTags(event.target.value)}
                  />
                </label>

                <div className="settings-button-row">
                  <button
                    className="settings-btn-secondary"
                    onClick={() => mdInputRef.current?.click()}
                    disabled={mdImporting || (mdImportMode === "document" && !mdImportPath.trim())}
                  >
                    {mdImporting
                      ? `导入中... ${mdImportProgress}/${mdImportTotal}`
                      : "选择 .md 文件"}
                  </button>
                  {(mdImporting || mdImportProgress > 0) && (
                    <span className="settings-import-progress">
                      {mdImportTotal > 0 ? `${mdImportProgress} / ${mdImportTotal} 已处理` : ""}
                      {mdImportCurrentFile ? ` · ${mdImportCurrentFile}` : ""}
                    </span>
                  )}
                  {mdImportCount > 0 && !mdImporting && (
                    <span className="settings-import-ok">
                      已导入 {mdImportCount} 篇笔记
                    </span>
                  )}
                  <input
                    ref={mdInputRef}
                    type="file"
                    accept=".md"
                    multiple
                    style={{ display: "none" }}
                    onChange={handleMdImport}
                  />
                </div>
              </div>
            </SettingsSection>

            {/* ═══════════════════════ */}
            {/* GitHub 备份 */}
            {/* ═══════════════════════ */}
            {settingsPage === "sync" && (
              <SettingsSync onBusyChange={onSyncBusy} onPullDone={onPullDone} />
            )}

            {/* ── 回收站自动清理：设置项末尾 ── */}
            <Field label="回收站自动清理" desc="超过此天数的已删除笔记自动清除。0=不自动清理" visible={settingsPage === "advanced"}>
              <div className="settings-stepper">
                <button
                  className="settings-step-btn"
                  onClick={() => update({ auto_clean_days: Math.max(0, config.auto_clean_days - 7) })}
                >−</button>
                <span className={`settings-value ${chk("auto_clean_days", 0)}`}>
                  {config.auto_clean_days === 0 ? "关闭" : `${config.auto_clean_days} 天`}
                </span>
                <button
                  className="settings-step-btn"
                  onClick={() => update({ auto_clean_days: Math.min(365, config.auto_clean_days + 7) })}
                >+</button>
              </div>
            </Field>

            {!isTauri() && (
              <Field label="Web 搜索索引" desc="索引可随时从 IndexedDB 原始笔记重新生成，不会修改笔记数据" visible={settingsPage === "advanced"}>
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

            {/* ── 保存反馈 ── */}
            {message && <div className="settings-toast">{message}</div>}

            {/* ── 版本 ── */}
            {settingsPage === "root" && (
              <div className="settings-version">v{__APP_VERSION__}</div>
            )}
          </div>
        )}
      </div>
      {editorAppearanceOpen && config && (
        <EditorAppearancePanel
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

function formatStorageBytes(bytes: number | null): string {
  if (bytes === null) return "不可用";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

// ── 快捷键配置 ──

function HotkeyConfig({ config, onUpdate }: {
  config: AppConfig;
  onUpdate: (hk: Record<string, string>) => void;
}) {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const startRecord = (id: string) => {
    setRecordingError(null);
    setRecordingId(id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    if (e.key === "Escape") {
      setRecordingId(null);
      return;
    }
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;

    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");

    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    parts.push(key);

    const shortcut = parts.join("+");
    if (isDocumentFindShortcut(shortcut)) {
      setRecordingError("Ctrl+F 已保留给 Vim 翻页，Cmd+F 与 Alt+F 已保留给当前文档查找。");
      setRecordingId(null);
      return;
    }
    if (isEditorLineJumpShortcut(shortcut)) {
      setRecordingError("Alt+G 已保留给当前文档跳转行号，请使用其他组合键。");
      setRecordingId(null);
      return;
    }
    const updated = { ...config.hotkeys, [recordingId!]: shortcut };
    onUpdate(updated);
    setRecordingId(null);
  };

  const resetHotkey = (id: string) => {
    const updated = { ...config.hotkeys, [id]: DEFAULT_HOTKEYS[id] };
    onUpdate(updated);
  };

  return (
    <div className="hotkey-list">
      <div className="hotkey-reserved-note">Cmd+F、Alt+F：当前文档查找；Alt+G：跳转行号；Vim Normal/Visual 会优先接管 Ctrl 导航键，格式快捷键只在 Insert 生效</div>
      {recordingError && <div className="hotkey-recording-error" role="status">{recordingError}</div>}
      {Object.entries(HOTKEY_LABELS).map(([id, label]) => {
        const current = config.hotkeys?.[id] || DEFAULT_HOTKEYS[id];
        const isRecording = recordingId === id;

        return (
          <div key={id} className="hotkey-row">
            <span className="hotkey-label">{label}</span>
            {isRecording ? (
              <input
                className={`hotkey-input recording`}
                value="按下新快捷键…"
                readOnly
                onKeyDown={handleKeyDown}
                onBlur={() => setRecordingId(null)}
                autoFocus
              />
            ) : (
              <button
                className="hotkey-btn"
                onClick={() => startRecord(id)}
                title="点击修改快捷键"
              >
                <kbd>{formatShortcut(current)}</kbd>
              </button>
            )}
            <button
              className="hotkey-reset"
              onClick={() => resetHotkey(id)}
              title="恢复默认"
              disabled={current === DEFAULT_HOTKEYS[id]}
            >
              ↺
            </button>
          </div>
        );
      })}
    </div>
  );
}

function formatShortcut(s: string): string {
  return s
    .replace("CommandOrControl", navigator.platform.includes("Mac") ? "⌘" : "Ctrl")
    .replace("Alt", navigator.platform.includes("Mac") ? "⌥" : "Alt")
    .replace("Shift", navigator.platform.includes("Mac") ? "⇧" : "Shift")
    .replace(/\+/g, " + ");
}

// ── 字段包装 ──

function Field({ label, desc, children, visible = true }: { label: string; desc: string; children: React.ReactNode; visible?: boolean }) {
  if (!visible) return null;
  return (
    <div className="settings-field">
      <div className="settings-label">{label}</div>
      <div className="settings-desc">{desc}</div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

// ── 分区标题 ──

function SettingsSection({ title, desc, children, visible = true }: { title: string; desc: string; children: React.ReactNode; visible?: boolean }) {
  if (!visible) return null;
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-title">{title}</div>
        <div className="settings-section-desc">{desc}</div>
      </div>
      <div className="settings-section-body">
        {children}
      </div>
    </div>
  );
}
