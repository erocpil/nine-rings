import { useState } from "react";

export function PropertyRename({ value, kind, disabled, onRename }: {
  value: string;
  kind: "文档" | "路径";
  disabled?: boolean;
  onRename: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!editing) return <div className="prop-rename">
    <span className="prop-empty">{value || "无标题"}</span>
    <button type="button" className="settings-sm-btn" disabled={disabled} onClick={() => {
      setDraft(value); setError(""); setEditing(true);
    }}>重命名{kind}</button>
  </div>;
  return <form className="prop-rename" aria-label={`重命名${kind}`} onSubmit={async event => {
    event.preventDefault();
    if (busy || disabled) return;
    const name = draft.trim();
    if (!name) { setError("名称不能为空"); return; }
    // The document title updates optimistically. After a failed save, retry
    // persistence even if the displayed value already matches the draft.
    if (name === value && !error) { setEditing(false); return; }
    setBusy(true); setError("");
    try { await onRename(name); setEditing(false); }
    catch (error) { setError(`重命名失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  }}>
    <input className="prop-input" aria-label={`${kind}新名称`} value={draft} disabled={busy || disabled} autoFocus
      onFocus={event => event.target.select()} onChange={event => setDraft(event.target.value)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) { if (event.key === "Enter") event.preventDefault(); return; }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) setEditing(false); }
      }} />
    <div className="prop-security-actions">
      <button className="settings-sm-btn" type="submit" disabled={busy || disabled}>{busy ? "保存中…" : "保存名称"}</button>
      <button className="settings-sm-btn" type="button" disabled={busy} onClick={() => setEditing(false)}>取消</button>
    </div>
    {error && <div className="prop-security-message error" role="alert">{error}</div>}
  </form>;
}
