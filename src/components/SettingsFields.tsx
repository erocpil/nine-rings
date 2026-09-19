import { useId, type ReactNode } from "react";

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
  const id = useId();
  if (!visible) return null;
  return (
    <div
      className="settings-field"
      data-settings-label={label}
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-desc`}
    >
      <div className="settings-label" id={`${id}-label`}>
        {label}
      </div>
      <div className="settings-desc" id={`${id}-desc`}>
        {desc}
      </div>
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
    <div className="settings-section" data-settings-label={title}>
      <div className="settings-section-header">
        <div className="settings-section-title">{title}</div>
        <div className="settings-section-desc">{desc}</div>
      </div>
      <div className="settings-section-body">{children}</div>
    </div>
  );
}
