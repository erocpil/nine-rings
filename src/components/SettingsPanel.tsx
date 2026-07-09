import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AppConfig } from "../types/models";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfigChange: (config: AppConfig) => void;
}

export function SettingsPanel({ open, onClose, onConfigChange }: Props) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null); // field key being saved
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.config.get().then((c) => {
      setConfig(c);
      setLoading(false);
    });
  }, [open]);

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

  if (!open) return null;

  const chk = (key: keyof AppConfig, val: any) => saving === key ? "saving" : "";

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
            <Field label="主题" desc="system 跟随系统，light/dark 固定">
              <div className="settings-radio-group">
                {(["system", "light", "dark"] as const).map((v) => (
                  <button
                    key={v}
                    className={`settings-radio ${config.theme === v ? "active" : ""} ${chk("theme", v)}`}
                    onClick={() => update({ theme: v })}
                  >
                    {v === "system" ? "跟随系统" : v === "light" ? "浅色" : "深色"}
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

            {/* ── 自动清理天数 ── */}
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

            {/* ── 保存反馈 ── */}
            {message && <div className="settings-toast">{message}</div>}
          </div>
        )}
      </div>
    </div>
  );
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
