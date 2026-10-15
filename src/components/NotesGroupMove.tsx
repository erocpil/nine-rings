import { useState } from "react";
import { QUICK_NOTES_PATH, quickNoteGroupPath, quickNoteName } from "../lib/quick-notes";

/** Destination selection is shared by single-note, batch and whole-group moves. */
export function NotesGroupMove({ count, paths, busy, onMove, onCancel }: {
  count: number;
  paths: string[];
  busy: boolean;
  onMove: (path: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState(QUICK_NOTES_PATH);
  const [name, setName] = useState(quickNoteName);
  const [error, setError] = useState("");
  return <form className="notes-panel-name-form notes-group-move" aria-label="移动随记"
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) onCancel(); }
    }}
    onSubmit={event => {
      event.preventDefault();
      if (busy) return;
      setError("");
      let path: string;
      try { path = target || quickNoteGroupPath(name); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
      void onMove(path);
    }}>
    <span className="notes-group-move-summary">移动 {count} 篇随记，正文和标题保持不变</span>
    <label>目标分组<select autoFocus aria-label="目标分组" value={target} disabled={busy} onChange={event => { setTarget(event.target.value); setError(""); }}>
      <option value={QUICK_NOTES_PATH}>未分组（取消分组）</option>
      {paths.map(path => <option key={path} value={path}>{path.slice(QUICK_NOTES_PATH.length + 1)}</option>)}
      <option value="">新建分组…</option>
    </select></label>
    {!target && <label>新分组名称<input aria-label="新分组名称" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>}
    {error && <span role="alert">{error}</span>}
    <button type="submit" disabled={busy}>移动</button>
    <button type="button" disabled={busy} onClick={onCancel}>取消</button>
  </form>;
}
