import { useCallback, useEffect, useRef, useState } from "react";
import type { Note, NoteVersion } from "../types/models";
import { api } from "../lib/api";

interface VersionHistoryProps {
  open: boolean;
  noteId: string | null;
  onClose: () => void;
  onBeforeRestore: () => Promise<void>;
  onRestore: (note: Note) => void;
}

export function VersionHistory({ open, noteId, onClose, onBeforeRestore, onRestore }: VersionHistoryProps) {
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const restoringRef = useRef(false);
  const requestRef = useRef(0);
  const [error, setError] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    if (!noteId) return;
    const request = ++requestRef.current;
    setLoading(true);
    setVersions([]);
    setError(null);
    try {
      const list = await api.versions.list(noteId);
      if (request === requestRef.current) setVersions(list);
    } catch (e) {
      if (request === requestRef.current) setError(`加载版本历史失败：${String(e)}`);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    const requests = requestRef;
    if (open && noteId) loadVersions();
    return () => { requests.current++; };
  }, [open, noteId, loadVersions]);

  const handleRestore = async (versionId: string) => {
    if (restoringRef.current || !window.confirm("恢复此历史版本？将用历史数据替换这篇笔记的标题、正文等内容。恢复前会先保存当前编辑，并保留当前版本供再次恢复。")) return;
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

  if (!open) return null;

  return (
    <div className="dialog-overlay confirm-overlay" onClick={() => { if (!restoringRef.current) onClose(); }}>
      <div
        className="dialog version-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header version-header">
          <h3 id="version-history-title">版本历史</h3>
          <button className="dialog-close version-close" disabled={restoring !== null} onClick={onClose} aria-label="关闭版本历史">
            ✕
          </button>
        </div>

        <div className="dialog-body version-content">
          {error && <div className="dialog-action-error" role="alert">{error} <button disabled={restoring !== null} onClick={loadVersions}>重新加载</button></div>}
          {loading && <div className="version-loading">加载中...</div>}

          {!loading && !error && versions.length === 0 && (
            <div className="version-empty">暂无历史版本</div>
          )}

          {versions.map((v) => (
            <div key={v.id} className="version-item">
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
              <button
                className="version-btn-restore"
                disabled={restoring !== null || loading}
                onClick={() => handleRestore(v.id)}
              >
                {restoring === v.id ? "恢复中..." : "恢复"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
