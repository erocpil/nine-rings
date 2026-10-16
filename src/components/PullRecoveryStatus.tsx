import { useEffect, useRef, useState } from "react";
import {
  listPullSummaries,
  PULL_CHANGED,
  type PullSummary,
} from "../lib/sync/pull-store";
import type { SyncConfig } from "../lib/sync/github";
import { CURRENT_SYNC_CAPABILITIES } from "../lib/sync/protocol-capabilities";
export function PullRecoveryStatus({
  compact = false,
  onOpenSettings,
  config,
  onBeforeSnapshot,
  onOperationChange,
  onPullDone,
  disabled = false,
}: {
  compact?: boolean;
  onOpenSettings?: () => void;
  config?: SyncConfig;
  onBeforeSnapshot?: () => Promise<void>;
  onOperationChange?: (busy: boolean) => void;
  onPullDone?: () => void;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<PullSummary[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void listPullSummaries()
        .then((values) => {
          if (active) {
            setRows(
              values.filter(
                (row) => !["COMPLETE", "ABORTED"].includes(row.phase),
              ),
            );
            setError("");
          }
        })
        .catch(() => {
          if (active)
            setError("增量应用恢复状态无法读取；不会重试导入或回滚。");
        });
    };
    refresh();
    window.addEventListener(PULL_CHANGED, refresh);
    window.addEventListener("focus", refresh);
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(PULL_CHANGED)
        : null;
    if (channel) channel.onmessage = refresh;
    const requests = sequence;
    return () => {
      active = false;
      requests.current++;
      window.removeEventListener(PULL_CHANGED, refresh);
      window.removeEventListener("focus", refresh);
      channel?.close();
    };
  }, []);
  if (!rows.length && !error) return null;
  const recover = async (row: PullSummary) => {
    if (!config || !onBeforeSnapshot) return;
    const id = ++sequence.current;
    setBusy(true);
    onOperationChange?.(true);
    setError("");
    setMessage("");
    try {
      const { recoverIncrementalPull } =
        await import("../lib/sync/incremental-actions");
      const result = await recoverIncrementalPull(
        config,
        row.spaceId,
        onBeforeSnapshot,
      );
      if (id !== sequence.current) return;
      setMessage(
        result.restoreWarning
          ? "接受已确认，通用恢复提示仍需检查。"
          : "已核验实际内容并完成接受确认，未重试导入。",
      );
      onPullDone?.();
    } catch (reason) {
      if (id === sequence.current)
        setError(
          reason instanceof Error ? reason.message : "核验失败，记录已保留",
        );
    } finally {
      if (id === sequence.current) {
        setBusy(false);
        onOperationChange?.(false);
      }
    }
  };
  return (
    <div
      className={
        compact ? "tab-conflict-banner" : "backup-restore-status needs-review"
      }
      role="status"
    >
      <span>
        {error ||
          `检测到 ${rows.length} 项未完成的增量应用或接受确认；不会自动重试或回滚。`}
      </span>
      {compact ? (
        <button type="button" onClick={onOpenSettings}>
          查看备份设置
        </button>
      ) : (
        <>
          {rows.map((row) => (
            <div key={row.spaceId} className="settings-row">
              <span>
                {row.space
                  ? `${row.space.owner}/${row.space.repo}`
                  : row.spaceId.slice(0, 12)}{" "}
                · {row.mode === "equal" ? "相同内容确认" : "远端应用"} ·{" "}
                {row.phase}
              </span>
              <button
                type="button"
                className="settings-btn"
                disabled={
                  disabled ||
                  busy ||
                  !config ||
                  !onBeforeSnapshot ||
                  CURRENT_SYNC_CAPABILITIES.read < 1
                }
                onClick={() => void recover(row)}
              >
                核对实际内容并确认恢复
              </button>
            </div>
          ))}
          {CURRENT_SYNC_CAPABILITIES.read < 1 && (
            <p>
              当前版本尚未认证增量读取，暂不能确认这些记录；请使用支持版本检查。
            </p>
          )}
          {message && <p>{message}</p>}
        </>
      )}
    </div>
  );
}
