import React, { useEffect, useState, useRef } from "react";
import { api } from "../lib/api";
import type { AppConfig } from "../types/models";
import { DEFAULT_HOTKEYS, HOTKEY_LABELS } from "../types/models";
import { mdToDelta, extractTitle } from "../lib/md-parser";
import { isTauri, exportWithDialog, importWithDialog } from "../lib/tauri-desktop";
import SettingsSync from "./SettingsSync";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfigChange: (config: AppConfig) => void;
  onImport?: () => void;
}

export function SettingsPanel({ open, onClose, onConfigChange, onImport }: Props) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      api.config.get(),
      api.tags.listAll(),
    ]).then(([c, tags]) => {
      setConfig(c);
      setAllTags(tags);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [open]);

  const refreshTags = () => {
    api.tags.listAll().then(setAllTags).catch(() => {});
  };

  const update = async (partial: Partial<AppConfig>) => {
    if (!config) return;
    const key = Object.keys(partial)[0];
    setSaving(key);
    try {
      const merged = await api.config.set(partial);
      setConfig(merged);
      onConfigChange(merged);
      setMessage(`已更新`);
      setTimeout(() => setMessage(null), 1500);
    } catch (e) {
      setMessage(`保存失败: ${e}`);
    } finally {
      setSaving(null);
    }
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
        a.download = `nine-rings-${new Date().toISOString().slice(0, 10)}.json`;
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
    const today = new Date().toISOString().slice(0, 10);
    let count = 0;
    try {
      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi];
        const text = await file.text();
        const title = extractTitle(text, file.name.replace(/\.md$/, ""));
        const delta = mdToDelta(text);
        await api.notes.create({
          date: today,
          title,
          content: delta as any,
        });
        count++;
      }
      setMdImportCount(count);
      onImport?.();
      // Reset input so same files can be re-imported
      e.target.value = "";
    } catch (err) {
      setMessage(`导入失败: ${err}`);
    } finally {
      setMdImporting(false);
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
          <div className="settings-loading">加载失败</div>
        ) : (
          <div className="settings-body">
            {/* ── 主题 ── */}
            <Field label="主题" desc="切换整体配色">
              <div className="settings-radio-group">
                {([["light", "浅", "#e2e2e2"],
                ["dark", "深", "#0d1117"],
                ["azure-dark", "暗", "#1e3050"],
                ["fu", "芙", "#81D8D0"],
                ["azure", "蔚", "#3b6dcc"],
                ["sui", "粋", "#4a8a3a"],
                ["grace", "雅", "#7c3aed"],
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

            {/* ── 回收站自动清理 ── */}
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

            {/* ── 字号 ── */}
            <Field label="正文字号" desc="编辑器内容区域字体大小 (12–32px)">
              <div className="settings-stepper">
                <button
                  className="settings-step-btn"
                  onClick={() => update({ note_font_size: Math.max(12, config.note_font_size - 1) })}
                >−</button>
                <span className={`settings-value ${chk("note_font_size", 0)}`}>
                  {config.note_font_size}px
                </span>
                <button
                  className="settings-step-btn"
                  onClick={() => update({ note_font_size: Math.min(32, config.note_font_size + 1) })}
                >+</button>
              </div>
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

            {/* ── 显示行号 ── */}
            <Field label="显示行号" desc="编辑器左侧显示行号（基于段落计数）">
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

            {/* ── 同步 ── */}
            <Field label="启用同步" desc="跨设备同步（需要对接同步后端）">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={config.enable_sync}
                  onChange={(e) => update({ enable_sync: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-label">{config.enable_sync ? "开" : "关"}</span>
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
            <SettingsSection title="Markdown 导入" desc="将 .md 文件导入为笔记（支持批量多选）">
              <div className="settings-button-row">
                <button
                  className="settings-btn-secondary"
                  onClick={() => mdInputRef.current?.click()}
                  disabled={mdImporting}
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
            </SettingsSection>

            {/* ═══════════════════════ */}
            {/* GitHub 同步 */}
            {/* ═══════════════════════ */}
            <SettingsSync />

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
