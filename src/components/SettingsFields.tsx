import type { ReactNode } from "react";

// ── 字段包装 ──

export function Field({
  label,
  desc,
  children,
  visible = true,
}: {
  label: string;
  desc: string;
  children: ReactNode;
  visible?: boolean;
}) {
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

export function SettingsSection({
  title,
  desc,
  children,
  visible = true,
}: {
  title: string;
  desc: string;
  children: ReactNode;
  visible?: boolean;
}) {
  if (!visible) return null;
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-title">{title}</div>
        <div className="settings-section-desc">{desc}</div>
      </div>
      <div className="settings-section-body">{children}</div>
    </div>
  );
}
