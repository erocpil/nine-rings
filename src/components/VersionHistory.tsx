import { useDialogFocus } from "../hooks/useDialogFocus";
import { OperationError } from "./OperationError";
import { useConfirmation } from "./ConfirmationDialog";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Note, NoteVersion } from "../types/models";
import { DocumentComparison } from "./DocumentComparison";
import { DocumentContentPreview } from "./DocumentContentPreview";
import { documentPreview } from "../lib/sync/backup-merge";
import { isEncrypted } from "../lib/document-crypto";
import { api } from "../lib/api";

interface VersionHistoryProps {
  open: boolean;
  noteId: string | null;
  onClose: () => void;
  onBeforeRestore: () => Promise<void>;
  onRestore: (note: Note) => void;
}

export function VersionHistory({ open, noteId, onClose, onBeforeRestore, onRestore }: VersionHistoryProps) {
  const { confirm, confirmationDialog } = useConfirmation(open, noteId);
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  // A historical snapshot is most useful when its changes from the live
  // document are visible immediately. Keep the original-only preview as an
  // explicit option for inspecting the saved snapshot without comparison.
  const [compare, setCompare] = useState(true);
  const [current, setCurrent] = useState<Note | null>(null);
  const [keep, setKeep] = useState(5);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const restoringRef = useRef(false);
  const requestRef = useRef(0);
  const previewRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(panelRef, open, closeRef);
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || confirmationDialog) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!restoringRef.current) onClose();
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [open, onClose, confirmationDialog]);
  useEffect(() => {
    if (previewId) previewRef.current?.scrollIntoView({ block: "nearest" });
  }, [previewId]);
  const [error, setError] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    if (!noteId) return;
    const request = ++requestRef.current;
    setLoading(true);
    setVersions([]);
    setError(null);
    try {
      await onBeforeRestore();
      const [list, note] = await Promise.all([api.versions.list(noteId), api.notes.get(noteId)]);
      if (request === requestRef.current) {
        setVersions(list);
        setCurrent(note);
        setSelected([]);
        setPreviewId(id => list.some(v => v.id === id) ? id : null);
      }
    } catch (e) {
      if (request === requestRef.current) setError(`加载版本历史失败：${String(e)}`);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [noteId, onBeforeRestore]);

  useEffect(() => {
    const requests = requestRef;
    if (open && noteId) loadVersions();
    return () => { requests.current++; };
  }, [open, noteId, loadVersions]);

  const handleRestore = async (versionId: string) => {
    if (restoringRef.current || !await confirm({ title: "恢复历史版本", description: "将用历史数据替换这篇笔记的标题、正文等内容。恢复前会先保存当前编辑，并保留当前版本供再次恢复。", confirmLabel: "恢复此版本" })) return;
    restoringRef.current = true;
    setRestoring(versionId);
    setError(null);
    try {
      await onBeforeRestore();
      const note = await api.versions.restore(versionId);
      onRestore(note);
      onClose();
    } catch (e) {
      setError(`恢复版本失败，请重试：${String(e)}`);
    } finally {
      setRestoring(null);
      restoringRef.current = false;
    }
  };

  const deleteVersions = async (ids: string[]) => {
    if (!noteId || !ids.length || restoringRef.current) return;
    const bytes = versions.filter(v => ids.includes(v.id)).reduce((sum, v) => sum + new Blob([JSON.stringify(v)]).size, 0);
    if (!await confirm({
      title: "删除历史版本",
      danger: true,
      description: `将永久删除 ${ids.length} 个本机历史版本（快照数据约 ${(bytes / 1024).toFixed(1)} KB，不代表数据库文件立即缩小）。当前文档不会改变；已有远端备份不会删除。此操作无法撤销。`,
      confirmLabel: "删除选中历史",
    })) return;
    restoringRef.current = true;
    setDeleting(true);
    try {
      await api.versions.delete(noteId, ids);
      await loadVersions();
    } catch (e) { setError(`清理历史失败：${String(e)}`); }
    finally { restoringRef.current = false; setDeleting(false); }
  };
  const preview = versions.find(v => v.id === previewId);
  const busy = loading || deleting || restoring !== null;
  if (!open) return null;

  return (
    <div className="dialog-overlay confirm-overlay" onClick={() => { if (!restoringRef.current) onClose(); }}>
      {confirmationDialog}
      <div
        ref={panelRef}
        className="dialog version-panel version-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header version-header">
          <h3 id="version-history-title">版本历史</h3>
          <button ref={closeRef} className="dialog-close version-close" disabled={busy} onClick={onClose} aria-label="关闭版本历史">
            ✕
          </button>
        </div>

        <div className="dialog-body version-content">
          <p className="version-help">本机完整快照，每篇最多 30 个。普通文档历史不随备份上传，加密历史随保护数据备份。</p>
          <div className="version-management-tools">
            <label><input type="checkbox" aria-label="全选历史" disabled={busy || !versions.length}
              checked={versions.length > 0 && selected.length === versions.length}
              onChange={e => setSelected(e.target.checked ? versions.map(v => v.id) : [])} />全选</label>
            <button disabled={busy || !selected.length} onClick={() => void deleteVersions(selected)}>删除选中（{selected.length}）</button>
            <label>保留最近 <select aria-label="保留版本数" value={keep} disabled={busy} onChange={e => setKeep(Number(e.target.value))}>
              {[1, 3, 5, 10, 20].map(n => <option key={n} value={n}>{n} 个</option>)}
            </select></label>
            <button disabled={busy || versions.length <= keep} onClick={() => void deleteVersions(versions.slice(keep).map(v => v.id))}>清理更早版本</button>
          </div>
          {error && <OperationError key={error} message={error} disabled={busy} onRetry={loadVersions} />}
          {loading && <div className="version-loading">加载中...</div>}

          {!loading && !error && versions.length === 0 && (
            <div className="version-empty">暂无历史版本</div>
          )}

          {versions.map((v) => (
            <div key={v.id} className="version-item">
              <input type="checkbox" aria-label={`选择历史 ${v.title || "无标题"} ${v.saved_at}`}
                disabled={busy} checked={selected.includes(v.id)}
                onChange={e => setSelected(ids => e.target.checked ? [...ids, v.id] : ids.filter(id => id !== v.id))} />
              <div className="version-item-info">
                <div className="version-item-title">
                  {v.title || "无标题"}
                </div>
                <div className="version-item-date">
                  {new Date(v.saved_at).toLocaleString("zh-CN", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                {v.tags.length > 0 && (
                  <div className="version-item-tags">
                    {v.tags.map((t) => (
                      <span key={t} className="version-tag">{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <button disabled={busy} aria-pressed={previewId === v.id} onClick={() => { setPreviewId(v.id); setCompare(true); }}>预览</button>
              <button
                className="version-btn-restore"
                disabled={busy}
                onClick={() => handleRestore(v.id)}
              >
                {restoring === v.id ? "恢复中..." : "恢复"}
              </button>
            </div>
          ))}
          {preview && <section ref={previewRef} className="version-preview" aria-label="历史版本预览">
            <div className="version-management-tools">
              <strong>{preview.title || "无标题"} · {new Date(preview.saved_at).toLocaleString()}</strong>
              <button aria-pressed={compare} disabled={!current || busy} onClick={() => setCompare(v => !v)}>{compare ? "仅预览历史版本" : "与当前版本对比"}</button>
              <button onClick={() => setPreviewId(null)} aria-label="关闭历史预览">✕</button>
            </div>
            {compare && current
              ? <DocumentComparison left={documentPreview({ ...preview, id: preview.note_id })} right={documentPreview({ ...current })} leftLabel="历史版本" rightLabel="当前文档" />
              : <DocumentContentPreview content={preview.content} encrypted={isEncrypted(preview.content)} />}
          </section>}
        </div>
      </div>
    </div>
  );
}
