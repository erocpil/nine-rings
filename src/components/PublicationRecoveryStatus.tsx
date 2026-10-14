import { useEffect, useState } from "react";
import {
  listPublicationSummaries,
  PUBLICATION_CHANGED,
  type PublicationSummary,
} from "../lib/sync/publication-store";
import type { SyncConfig } from "../lib/sync/github";
/** Startup only reads small local summaries; remote verification is an explicit GET-only action. */
export function PublicationRecoveryStatus({
  compact = false,
  onOpenSettings,
  config,
}: {
  compact?: boolean;
  onOpenSettings?: () => void;
  config?: SyncConfig;
}) {
  const [rows, setRows] = useState<PublicationSummary[]>([]),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void listPublicationSummaries()
        .then((values) => {
          if (active) setRows(values.filter((row) => row.phase !== "COMPLETE"));
        })
        .catch(() => {
          if (active)
            setError("发布恢复状态无法读取，请勿直接重试未确认的发布。");
        });
    refresh();
    window.addEventListener(PUBLICATION_CHANGED, refresh);
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(PUBLICATION_CHANGED)
        : null;
    if (channel) channel.onmessage = refresh;
    return () => {
      active = false;
      window.removeEventListener(PUBLICATION_CHANGED, refresh);
      channel?.close();
    };
  }, []);
  if (!rows.length && !error) return null;
  return (
    <div
      className={
        compact ? "tab-conflict-banner" : "backup-restore-status needs-review"
      }
      role="status"
    >
      <span>
        {error ??
          `检测到 ${rows.length} 项未完成的备份发布；不会自动重发或回滚。`}
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
                {row.space.owner}/{row.space.repo} · {row.phase}
              </span>
              <button
                type="button"
                className="settings-btn"
                disabled={busy || !config?.token}
                onClick={async () => {
                  if (!config) return;
                  setBusy(true);
                  setError(null);
                  try {
                    const { recoverPublicationFromGitHub } =
                      await import("../lib/sync/github");
                    const result = await recoverPublicationFromGitHub(
                      config,
                      row.spaceId,
                    );
                    setMessage(
                      result === "complete"
                        ? "已核实发布并确认冻结基线。"
                        : result === "not-published"
                          ? "此记录未进入发布或已被明确拒绝；未重发请求。"
                          : "发布结果仍无法确认，记录已保留；未重发请求。",
                    );
                  } catch (reason) {
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "发布核实失败，记录已保留",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                只读核实发布
              </button>
            </div>
          ))}
          {message && <p>{message}</p>}
        </>
      )}
    </div>
  );
}
