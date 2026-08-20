import React, { useEffect, useState, useRef } from "react";
import { api } from "../lib/api";
import { localDateKey } from "../lib/local-date";
import type { AppConfig, DocType } from "../types/models";
import { DEFAULT_HOTKEYS, HOTKEY_LABELS } from "../types/models";
import { buildMarkdownImportInput, parseMetadataList } from "../lib/markdown-import";
import { isTauri, exportWithDialog, importWithDialog } from "../lib/tauri-desktop";
import SettingsSync from "./SettingsSync";
import { withTimeout } from "../lib/async";
import { DEFAULT_EDITOR_APPEARANCE, editorAppearanceVariables } from "../lib/editor-appearance";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfigChange: (config: AppConfig) => void;
  onImport?: () => void;
  /** 同步进行中回调 — 用来 freeze 编辑区 */
  onSyncBusy?: (busy: boolean) => void;
  /** Pull 完成后回调 — 刷新侧栏和文档树 */
  onPullDone?: () => void;
}

export function SettingsPanel({ open, onClose, onConfigChange, onImport, onSyncBusy, onPullDone }: Props) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const configRef = useRef<AppConfig | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const updateVersionRef = useRef(0);

  // ── 标签管理状态 ──
  const [allTags, setAllTags] = useState<string[]>([]);
  const [renameTag, setRenameTag] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  // ── 导入状态 ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  // ── Markdown 导入状态 ──
  const mdInputRef = useRef<HTMLInputElement>(null);
  const [mdImporting, setMdImporting] = useState(false);
  const [mdImportCount, setMdImportCount] = useState(0);
  const [mdImportMode, setMdImportMode] = useState<"document" | "note">("document");
  const [mdImportPath, setMdImportPath] = useState("references/imported");
  const [mdImportDocType, setMdImportDocType] = useState<DocType>("reference");
  const [mdImportTags, setMdImportTags] = useState("");
  const [mdImportConcepts, setMdImportConcepts] = useState("");

  const loadSettings = () => {
    setLoading(true);
    setLoadError(null);
    withTimeout(Promise.all([
      api.config.get(),
      api.tags.listAll(),
    ]), 15000, "加载设置").then(([c, tags]) => {
      configRef.current = c;
      setConfig(c);
      setAllTags(tags);
    }).catch((error) => {
      console.error("[SettingsPanel] 加载失败:", error);
      setLoadError(error instanceof Error ? error.message : String(error));
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) loadSettings();
  }, [open]);

  const refreshTags = () => {
    api.tags.listAll().then(setAllTags).catch(() => {});
  };

  const update = (partial: Partial<AppConfig>) => {
    if (!configRef.current) return;
    const key = Object.keys(partial)[0];
    const version = ++updateVersionRef.current;
    const optimistic = { ...configRef.current, ...partial };
    configRef.current = optimistic;
    setConfig(optimistic);
    onConfigChange(optimistic);
    setSaving(key);
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const merged = await api.config.set(partial);
          if (version === updateVersionRef.current) {
            configRef.current = merged;
            setConfig(merged);
            onConfigChange(merged);
            setSaving(null);
            setMessage("已更新");
            setTimeout(() => setMessage(null), 1500);
          }
        } catch (error) {
          if (version === updateVersionRef.current) {
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

  const handleImport = async () => {
    setImporting(true);
    try {
      if (isTauri()) {
        const result = await importWithDialog();
        if (result) {
          setMessage(`导入完成：${result.notes_imported} 篇笔记, ${result.pages_imported} 个页面`);
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
      setMessage(`导入完成：${result.notes_imported} 篇笔记, ${result.pages_imported} 个页面`);
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
    const today = localDateKey();
    let count = 0;
    const failures: string[] = [];
    try {
      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi];
        try {
          const text = await file.text();
          const input = buildMarkdownImportInput(file.name, text, {
            date: today,
            mode: mdImportMode,
            storagePath: mdImportPath,
            docType: mdImportDocType,
            tags: parseMetadataList(mdImportTags),
            concepts: parseMetadataList(mdImportConcepts),
          });
          await api.notes.create(input);
          count++;
        } catch (error) {
          failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
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
      // 无论成功失败都允许再次选择同一批文件。
      e.target.value = "";
    }
  };

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>设置</h2>
          <button className="settings-close" onClick={onClose}>✕</button>
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
            {/* ── 主题 ── */}
            <Field label="主题" desc="切换整体配色">
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

            <SettingsSection title="编辑器排版" desc="仅改变阅读和编辑外观，不修改文档内容或 Markdown 导出结果">
              <EditorAppearanceSettings config={config} onUpdate={update} />
            </SettingsSection>

            {/* ── 默认视图 ── */}
            <Field label="默认视图" desc="打开应用时的默认布局">
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
            <Field label="待办跨日继承" desc="新每日页默认从未完成项继承待办">
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
            <Field label="高亮当前行" desc="编辑器光标所在行显示浅色背景">
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
            <Field label="显示块编号" desc="按顶层段落、列表、图片等内容块编号">
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

            {/* ── 正文右键菜单 ── */}
            <Field label="正文右键菜单" desc="开启后正文编辑器使用软件自带菜单，关闭则使用系统原生菜单">
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
            <Field label="Dev 端口" desc="Web 开发服务器端口（需重启 dev server 生效）">
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
            <SettingsSection title="快捷键" desc="点击快捷键后按下新组合键即可修改">
              <HotkeyConfig
                config={config}
                onUpdate={(hk) => update({ hotkeys: hk })}
              />
            </SettingsSection>

            {/* ═══════════════════════ */}
            {/* 标签管理 */}
            {/* ═══════════════════════ */}
            <SettingsSection title="标签管理" desc="管理所有笔记中的标签">

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
              {allTags.length === 0 ? (
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
            <SettingsSection title="数据导出 / 导入" desc="全量备份或迁移数据（JSON 格式）">
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
            <SettingsSection title="Markdown 导入" desc="导入一个或多个 .md 文件，并指定文档位置与元数据">
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
                  {mdImporting ? "导入中..." : "选择 .md 文件"}
                </button>
                {mdImportCount > 0 && (
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
            <SettingsSync onBusyChange={onSyncBusy} onPullDone={onPullDone} />

            {/* ── 回收站自动清理：设置项末尾 ── */}
            <Field label="回收站自动清理" desc="超过此天数的已删除笔记自动清除。0=不自动清理">
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

            {/* ── 保存反馈 ── */}
            {message && <div className="settings-toast">{message}</div>}

            {/* ── 版本 ── */}
            <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-tertiary)", marginTop: 16, opacity: 0.5 }}>
              v{__APP_VERSION__}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 字段包装 ──

function EditorAppearanceSettings({ config, onUpdate }: {
  config: AppConfig;
  onUpdate: (partial: Partial<AppConfig>) => void;
}) {
  const variables = editorAppearanceVariables(config) as React.CSSProperties;
  return (
    <div className="editor-appearance-settings">
      <Field label="正文字体" desc="选择编辑器正文的字体组合">
        <select
          className="settings-input editor-appearance-select"
          aria-label="正文字体"
          value={config.editor_font_family}
          onChange={(event) => onUpdate({ editor_font_family: event.target.value as AppConfig["editor_font_family"] })}
        >
          <option value="system">系统默认</option>
          <option value="sans">无衬线</option>
          <option value="serif">衬线 / 宋体</option>
          <option value="monospace">等宽字体</option>
        </select>
      </Field>

      <Field label="正文字号" desc="编辑器内容区域字体大小">
        <SettingsStepper
          label="正文字号"
          value={config.note_font_size}
          minimum={12}
          maximum={32}
          step={1}
          unit="px"
          onChange={(value) => onUpdate({ note_font_size: value })}
        />
      </Field>

      <Field label="行距" desc="正文各行之间的垂直距离">
        <SettingsStepper
          label="行距"
          value={config.editor_line_height}
          minimum={1.2}
          maximum={2.2}
          step={0.1}
          onChange={(value) => onUpdate({ editor_line_height: value })}
        />
      </Field>

      <Field label="段落首行缩进" desc="只应用于顶层正文段落，标题和列表不受影响">
        <SettingsStepper
          label="段落首行缩进"
          value={config.editor_paragraph_indent}
          minimum={0}
          maximum={2}
          step={0.5}
          unit="em"
          onChange={(value) => onUpdate({ editor_paragraph_indent: value })}
        />
      </Field>

      <Field label="列表层级缩进" desc="控制二级、三级列表圆点相对上一级的位置">
        <SettingsStepper
          label="列表层级缩进"
          value={config.editor_list_indent}
          minimum={1}
          maximum={3}
          step={0.05}
          unit="em"
          onChange={(value) => onUpdate({ editor_list_indent: value })}
        />
      </Field>

      <Field label="圆点文字间距" desc="控制无序列表圆点与其后文字的距离">
        <SettingsStepper
          label="圆点文字间距"
          value={config.editor_list_marker_gap}
          minimum={0.1}
          maximum={0.8}
          step={0.1}
          unit="em"
          onChange={(value) => onUpdate({ editor_list_marker_gap: value })}
        />
      </Field>

      <Field label="引用块缩进" desc="控制引用竖线与正文之间的距离">
        <SettingsStepper
          label="引用块缩进"
          value={config.editor_blockquote_indent}
          minimum={4}
          maximum={32}
          step={2}
          unit="px"
          onChange={(value) => onUpdate({ editor_blockquote_indent: value })}
        />
      </Field>

      <Field label="搜索关键字颜色" desc="Ctrl-F 和笔记搜索定位时的匹配背景色">
        <label className="settings-color-control">
          <input
            type="color"
            aria-label="搜索关键字颜色"
            value={config.editor_search_highlight_color}
            onChange={(event) => onUpdate({ editor_search_highlight_color: event.target.value })}
          />
          <span>{config.editor_search_highlight_color.toUpperCase()}</span>
        </label>
      </Field>

      <div className="editor-appearance-preview" style={variables} aria-label="编辑器排版预览">
        <p>排版预览：文字、行距与段落缩进</p>
        <ul>
          <li>一级列表
            <ul><li>二级列表的缩进与圆点间距</li></ul>
          </li>
        </ul>
        <mark>搜索关键字</mark>
      </div>
      <button
        className="settings-btn-secondary editor-appearance-reset"
        type="button"
        onClick={() => onUpdate({ ...DEFAULT_EDITOR_APPEARANCE })}
      >恢复默认排版</button>
    </div>
  );
}

function SettingsStepper({ label, value, minimum, maximum, step, unit = "", onChange }: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const decimals = String(step).split(".")[1]?.length ?? 0;
  const adjust = (direction: number) => {
    const next = Math.min(maximum, Math.max(minimum, value + direction * step));
    onChange(Number(next.toFixed(decimals)));
  };
  return (
    <div className="settings-stepper">
      <button type="button" aria-label={`减小${label}`} className="settings-step-btn" disabled={value <= minimum} onClick={() => adjust(-1)}>−</button>
      <span className="settings-value">{value.toFixed(decimals)}{unit}</span>
      <button type="button" aria-label={`增大${label}`} className="settings-step-btn" disabled={value >= maximum} onClick={() => adjust(1)}>+</button>
    </div>
  );
}

// ── 快捷键配置 ──

function HotkeyConfig({ config, onUpdate }: {
  config: AppConfig;
  onUpdate: (hk: Record<string, string>) => void;
}) {
  const [recordingId, setRecordingId] = useState<string | null>(null);

  const startRecord = (id: string) => setRecordingId(id);

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

function Field({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="settings-field">
      <div className="settings-label">{label}</div>
      <div className="settings-desc">{desc}</div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

// ── 分区标题 ──

function SettingsSection({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
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
