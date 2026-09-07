import { OperationError } from "./OperationError";
import { useConfirmation } from "./ConfirmationDialog";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "../types/models";
import { api } from "../lib/api";

interface RecycleBinProps {
  open: boolean;
  onClose: () => void;
  onNotesChanged?: () => void;
}

export function RecycleBin({ open, onClose, onNotesChanged }: RecycleBinProps) {
  const { confirm, confirmationDialog } = useConfirmation(open);
  const [deleted, setDeleted] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadRequest = useRef(0);

  const loadDeleted = useCallback(async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    setError(null);
    try {
      const list = await api.recycle.list();
      if (request === loadRequest.current) setDeleted(list);
    } catch (e) {
      if (request === loadRequest.current) setError(`加载回收站失败：${String(e)}`);
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const requests = loadRequest;
    if (open) { setNotice(null); void loadDeleted(); }
    return () => { requests.current++; };
  }, [open, loadDeleted]);

  const runOperation = async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try { await operation(); }
    catch (e) { setError(`操作失败，请重试：${String(e)}`); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const handleRestore = async (id: string) => {
    await runOperation(async () => {
      await api.recycle.restore(id);
      setDeleted((prev) => prev.filter((n) => n.id !== id));
      onNotesChanged?.();
      setNotice("已恢复");
    });
  };

  const handlePermanentDelete = async (id: string) => {
    if (busyRef.current || !await confirm({ title: "永久删除文档", description: `将永久删除“${deleted.find((note) => note.id === id)?.title || "无标题"}”。此操作无法从回收站恢复。`, confirmLabel: "永久删除", danger: true })) return;
    await runOperation(async () => {
      await api.recycle.permanentlyDelete(id);
      setDeleted((prev) => prev.filter((n) => n.id !== id));
      onNotesChanged?.();
      setNotice("已永久删除，无法从回收站恢复");
    });
  };

  const handleCleanOld = async () => {
    const days = 30; // 删除超过30天的
    if (busyRef.current || !await confirm({ title: "清理回收站", description: "将永久清理所有删除时间超过 30 天的记录。此操作无法从回收站恢复。", confirmLabel: "永久清理", danger: true })) return;
    await runOperation(async () => {
      const count = await api.recycle.cleanOld(days);
      if (count > 0) {
        await loadDeleted();
        onNotesChanged?.();
      }
      setNotice(count > 0 ? `已永久清理 ${count} 条记录，无法从回收站恢复` : "没有需要清理的记录");
    });
  };

  if (!open) return null;

  return (
    <div className="dialog-overlay confirm-overlay" onClick={() => { if (!busyRef.current) onClose(); }}>
      {confirmationDialog}
      <div
        className="dialog recycle-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recycle-bin-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header recycle-header">
          <h3 id="recycle-bin-title">回收站</h3>
          <button className="dialog-close recycle-close" disabled={busy} onClick={onClose} aria-label="关闭回收站">
            ✕
          </button>
        </div>

        <div className="dialog-body recycle-content">
          {error && <OperationError key={error} message={error} disabled={busy} onRetry={loadDeleted} />}
          {notice && <div role="status">{notice}</div>}
          {busy && <div role="status">正在处理…</div>}
          {loading && <div className="recycle-loading">加载中...</div>}

          {!loading && !error && deleted.length === 0 && (
            <div className="recycle-empty">回收站是空的</div>
          )}

          {deleted.map((note) => (
            <div key={note.id} className="recycle-item">
              <div className="recycle-item-info">
                <div className="recycle-item-title">
                  <span className="recycle-item-name">{note.title || "无标题"}</span>
                  {note.storagePath && (
                    <span className="recycle-item-path" title={note.storagePath}>{note.storagePath}</span>
                  )}
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
                  disabled={busy || loading}
                  onClick={() => handleRestore(note.id)}
                >
                  恢复
                </button>
                <button
                  className="recycle-btn-delete"
                  disabled={busy || loading}
                  onClick={() => handlePermanentDelete(note.id)}
                >
                  永久删除
                </button>
              </div>
            </div>
          ))}
        </div>

        {deleted.length > 0 && (
          <div className="dialog-footer recycle-footer">
            <button
              className="recycle-btn-clean"
              disabled={busy || loading}
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
