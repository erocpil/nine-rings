import { OperationError } from "./OperationError";
import { useConfirmation } from "./ConfirmationDialog";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "../types/models";
import { api } from "../lib/api";
import { ToolbarIcon } from "./ToolbarIcon";
import "./RecycleBin.css";

interface RecycleBinProps {
  open: boolean;
  onClose: () => void;
  onRestored?: () => void;
}

export function RecycleBin({ open, onClose, onRestored }: RecycleBinProps) {
  const { confirm, confirmationDialog } = useConfirmation(open);
  const [deleted, setDeleted] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const loadRequest = useRef(0);
  const selectedCount = deleted.filter((note) => selectedIds.has(note.id)).length;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedCount > 0 && selectedCount < deleted.length;
  }, [selectedCount, deleted.length]);

  const loadDeleted = useCallback(async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    setError(null);
    try {
      const list = await api.recycle.list();
      if (request === loadRequest.current) {
        setDeleted(list);
        const remaining = new Set(list.map((note) => note.id));
        setSelectedIds((previous) => new Set([...previous].filter((id) => remaining.has(id))));
      }
    } catch (e) {
      if (request === loadRequest.current) setError(`加载回收站失败：${String(e)}`);
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const requests = loadRequest;
    if (open) { setNotice(null); setSelectedIds(new Set()); void loadDeleted(); }
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
    finally { busyRef.current = false; setBusy(false); setProgress(null); }
  };

  const handleRestore = async (id: string) => {
    await runOperation(async () => {
      await api.recycle.restore(id);
      setDeleted((prev) => prev.filter((n) => n.id !== id));
      setSelectedIds((previous) => new Set([...previous].filter((value) => value !== id)));
      onRestored?.();
      setNotice("已恢复");
    });
  };

  const handlePermanentDelete = async (targets: Note[], kind: "single" | "selected" | "all") => {
    // Capture the exact displayed IDs before confirmation; clearing the bin
    // must not also delete records added while the confirmation was open.
    if (busyRef.current || loading || targets.length === 0) return;
    const subject = kind === "single" ? `“${targets[0].title || "无标题"}”`
      : kind === "all" ? `当前回收站中的全部 ${targets.length} 项文档和随笔` : `选中的 ${targets.length} 项文档和随笔`;
    if (!await confirm({
      title: kind === "single" ? "永久删除文档" : kind === "all" ? "清空回收站" : "批量永久删除",
      description: `将永久删除${subject}及其历史版本。此操作无法从回收站恢复，不影响正常文档。`,
      confirmLabel: kind === "all" ? "清空回收站" : "永久删除", danger: true,
    })) return;
    await runOperation(async () => {
      const removed = new Set<string>();
      const failed: { note: Note; reason: unknown }[] = [];
      setProgress({ completed: 0, total: targets.length });
      for (const [index, note] of targets.entries()) {
        try {
          await api.recycle.permanentlyDelete(note.id);
          removed.add(note.id);
        } catch (reason) { failed.push({ note, reason }); }
        if ((index + 1) % 20 === 0 || index + 1 === targets.length) {
          setProgress({ completed: index + 1, total: targets.length });
        }
      }
      // Remove only confirmed successes, once per batch. Failed entries stay
      // selected for retry; no tree refresh is needed for already-deleted notes.
      setDeleted((previous) => previous.filter((note) => !removed.has(note.id)));
      setSelectedIds((previous) => new Set([
        ...[...previous].filter((id) => !removed.has(id)), ...failed.map(({ note }) => note.id),
      ]));
      if (kind === "all") await loadDeleted();
      if (removed.size > 0) setNotice(kind === "single" ? "已永久删除，无法从回收站恢复"
        : `已永久删除 ${removed.size} 项，无法从回收站恢复${failed.length ? `；${failed.length} 项未删除` : ""}`);
      if (failed.length > 0) setError(`${failed.length} 项未删除，已保留勾选，可重试删除或刷新列表：\n${failed.slice(0, 5).map(({ note, reason }) => `${note.title || "无标题"}：${String(reason)}`).join("\n")}`);
    });
  };

  const handleCleanOld = async () => {
    const days = 30; // 删除超过30天的
    if (busyRef.current || !await confirm({ title: "清理回收站", description: "将永久清理所有删除时间超过 30 天的记录。此操作无法从回收站恢复。", confirmLabel: "永久清理", danger: true })) return;
    await runOperation(async () => {
      const count = await api.recycle.cleanOld(days);
      if (count > 0) {
        await loadDeleted();
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
          <span className="recycle-header-icon"><ToolbarIcon name="trash" /></span>
          <div className="recycle-heading">
            <div className="recycle-heading-title">
              <h3 id="recycle-bin-title">回收站</h3>
              {!loading && <span className="recycle-total">{deleted.length} 项</span>}
            </div>
            <p>已删除的内容可恢复到原位置</p>
          </div>
          <button className="dialog-close recycle-close" disabled={busy} onClick={onClose} aria-label="关闭回收站">
            <ToolbarIcon name="close" />
          </button>
        </div>

        {deleted.length > 0 && <div className="recycle-selection-bar">
          <label className="recycle-selection-toggle">
            <input ref={selectAllRef} type="checkbox" aria-label="全选回收站记录"
              checked={selectedCount === deleted.length} disabled={busy || loading}
              onChange={(event) => setSelectedIds(event.target.checked ? new Set(deleted.map((note) => note.id)) : new Set())} />
            全选
          </label>
          <span className={`recycle-selection-count${selectedCount > 0 ? " has-selection" : ""}`}>
            {selectedCount > 0 ? `已选 ${selectedCount} / ${deleted.length} 项` : "选择要处理的内容"}
          </span>
        </div>}

        {(error || notice || busy || loading) && <div className="recycle-feedback">
          {error && <OperationError key={error} message={error} disabled={busy} onRetry={loadDeleted} />}
          {(notice || busy || loading) && <div className={busy || loading ? "recycle-progress" : "recycle-notice"} role="status">
            <ToolbarIcon name={busy || loading ? "saving" : "check"} />
            <span>{busy ? (progress ? `正在永久删除… ${progress.completed} / ${progress.total}` : "正在处理…")
              : loading ? "正在加载回收站…" : notice}</span>
          </div>}
        </div>}

        <div className="dialog-body recycle-content" aria-busy={loading || busy}>
          {!loading && !busy && !error && deleted.length === 0 && (
            <div className="recycle-empty">
              <span className="recycle-empty-icon"><ToolbarIcon name="trash" /></span>
              <strong>回收站是空的</strong>
              <p>删除的文档和随笔会暂存在这里，方便找回。</p>
            </div>
          )}

          {deleted.map((note) => (
            <div key={note.id} className={`recycle-item${selectedIds.has(note.id) ? " is-selected" : ""}`}>
              <label className="recycle-item-select">
                <input type="checkbox" aria-label={`选择 ${note.title || "无标题"}`} checked={selectedIds.has(note.id)} disabled={busy || loading}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSelectedIds((previous) => {
                      const next = new Set(previous);
                      if (checked) next.add(note.id); else next.delete(note.id);
                      return next;
                    });
                  }} />
              </label>
              <div className="recycle-item-info">
                <div className="recycle-item-name" title={note.title || "无标题"}>{note.title || "无标题"}</div>
                <div className="recycle-item-path" title={note.storagePath || `随笔 · ${note.date}`}>
                  <ToolbarIcon name={note.storagePath ? "folder" : "note"} />
                  <span>{note.storagePath || `随笔 · ${note.date}`}</span>
                </div>
                <div className="recycle-item-date">
                  删除于{" "}
                  {new Date(note.deleted_at ?? note.updated_at).toLocaleString(
                    "zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
                  )}
                </div>
              </div>
              <div className="recycle-item-actions">
                <button
                  className="recycle-btn-restore"
                  disabled={busy || loading}
                  onClick={() => handleRestore(note.id)}
                >
                  <ToolbarIcon name="undo" />恢复
                </button>
                <button
                  className="recycle-btn-delete"
                  disabled={busy || loading}
                  onClick={() => handlePermanentDelete([note], "single")}
                >
                  永久删除
                </button>
              </div>
            </div>
          ))}
        </div>

        {deleted.length > 0 && (
          <div className="dialog-footer recycle-footer">
            <div className="recycle-footer-main">
              <button className="recycle-btn-delete recycle-delete-selected" disabled={busy || loading || selectedCount === 0}
                onClick={() => handlePermanentDelete(deleted.filter((note) => selectedIds.has(note.id)), "selected")}>
                <ToolbarIcon name="trash" />删除所选（{selectedCount}）
              </button>
              <button className="recycle-btn-delete recycle-clear" disabled={busy || loading}
                onClick={() => handlePermanentDelete([...deleted], "all")}>
                清空回收站
              </button>
            </div>
            <div className="recycle-footer-secondary">
              <button className="recycle-btn-clean" disabled={busy || loading} onClick={handleCleanOld}>
                清理 30 天前的记录
              </button>
              <span className="recycle-delete-hint"><ToolbarIcon name="warning" />永久删除后无法恢复</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
