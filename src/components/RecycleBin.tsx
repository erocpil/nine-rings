import { useCallback, useEffect, useState } from "react";
import type { Note } from "../types/models";
import { api } from "../lib/api";

interface RecycleBinProps {
  open: boolean;
  onClose: () => void;
}

export function RecycleBin({ open, onClose }: RecycleBinProps) {
  const [deleted, setDeleted] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);

  const loadDeleted = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.recycle.list();
      setDeleted(list);
    } catch (e) {
      console.error("加载回收站失败", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadDeleted();
  }, [open, loadDeleted]);

  const handleRestore = async (id: string) => {
    try {
      await api.recycle.restore(id);
      setDeleted((prev) => prev.filter((n) => n.id !== id));
    } catch (e) {
      console.error("恢复失败", e);
    }
  };

  const handlePermanentDelete = async (id: string) => {
    try {
      await api.recycle.permanentlyDelete(id);
      setDeleted((prev) => prev.filter((n) => n.id !== id));
    } catch (e) {
      console.error("永久删除失败", e);
    }
  };

  const handleCleanOld = async () => {
    const days = 30; // 删除超过30天的
    try {
      const count = await api.recycle.cleanOld(days);
      if (count > 0) {
        setDeleted((prev) =>
          prev.filter(
            (n) =>
              Date.now() - new Date(n.deleted_at ?? n.updated_at).getTime() <
              days * 86400000
          )
        );
      }
    } catch (e) {
      console.error("清理失败", e);
    }
  };

  if (!open) return null;

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div
        className="recycle-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="recycle-header">
          <h3>回收站</h3>
          <button className="recycle-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="recycle-content">
          {loading && <div className="recycle-loading">加载中...</div>}

          {!loading && deleted.length === 0 && (
            <div className="recycle-empty">回收站是空的</div>
          )}

          {deleted.map((note) => (
            <div key={note.id} className="recycle-item">
              <div className="recycle-item-info">
                <div className="recycle-item-title">
                  {note.title || "无标题"}
                </div>
                <div className="recycle-item-date">
                  删除于{" "}
                  {new Date(note.deleted_at ?? note.updated_at).toLocaleString(
                    "zh-CN"
                  )}
                </div>
              </div>
              <div className="recycle-item-actions">
                <button
                  className="recycle-btn-restore"
                  onClick={() => handleRestore(note.id)}
                >
                  恢复
                </button>
                <button
                  className="recycle-btn-delete"
                  onClick={() => handlePermanentDelete(note.id)}
                >
                  永久删除
                </button>
              </div>
            </div>
          ))}
        </div>

        {deleted.length > 0 && (
          <div className="recycle-footer">
            <button
              className="recycle-btn-clean"
              onClick={handleCleanOld}
            >
              清理 30 天前的记录
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
