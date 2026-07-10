import { useCallback, useEffect, useState } from "react";
import type { NoteVersion } from "../types/models";
import { api } from "../lib/api";

interface VersionHistoryProps {
  open: boolean;
  noteId: string | null;
  onClose: () => void;
  onRestore: () => void;
}

export function VersionHistory({ open, noteId, onClose, onRestore }: VersionHistoryProps) {
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    if (!noteId) return;
    setLoading(true);
    try {
      const list = await api.versions.list(noteId);
      setVersions(list);
    } catch (e) {
      console.error("加载版本历史失败", e);
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    if (open && noteId) loadVersions();
  }, [open, noteId, loadVersions]);

  const handleRestore = async (versionId: string) => {
    setRestoring(versionId);
    try {
      await api.versions.restore(versionId);
      onRestore();
      onClose();
    } catch (e) {
      console.error("恢复版本失败", e);
    } finally {
      setRestoring(null);
    }
  };

  if (!open) return null;

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div
        className="version-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="version-header">
          <h3>版本历史</h3>
          <button className="version-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="version-content">
          {loading && <div className="version-loading">加载中...</div>}

          {!loading && versions.length === 0 && (
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
                disabled={restoring === v.id}
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
