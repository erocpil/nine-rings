import { useEffect, useState, useSyncExternalStore } from "react";
import {
  readSyncProgress,
  subscribeSyncProgress,
} from "../lib/sync/operation-progress";
const elapsed = (milliseconds: number) =>
  `${Math.max(0, Math.floor(milliseconds / 1000))} 秒`;
const bytes = (n: number) =>
  n < 1024 * 1024
    ? `${(n / 1024).toFixed(1)} KiB`
    : `${(n / 1024 / 1024).toFixed(1)} MiB`;
export function SyncOperationProgress({ fallback }: { fallback: string }) {
  const progress = useSyncExternalStore(
    subscribeSyncProgress,
    readSyncProgress,
  );
  const [now, setNow] = useState(Date.now);
  const progressId = progress?.id;
  useEffect(() => {
    if (progressId === undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [progressId]);
  if (!progress) return <span>{fallback}</span>;
  const received = progress.receivedBytes;
  const idle = Math.max(0, now - progress.updatedAt);
  return (
    <div className="sync-operation-progress" aria-label="同步操作进度">
      <strong>{progress.stage}</strong>
      {progress.detail && <span>{progress.detail}</span>}
      {progress.historyBatch !== undefined && (
        <span>历史核验第 {progress.historyBatch} 批（本次最多 8 批），复用已核验缓存</span>
      )}
      {progress.inspectionMs !== undefined && <span>历史与快照预检已完成：{elapsed(progress.inspectionMs)}</span>}
      {progress.completedReads > 0 && (
        <span>本次已完成 {progress.completedReads} 次只读请求</span>
      )}
      {received !== undefined && (
        <span>
          已接收 {bytes(received)}
          {progress.totalBytes && progress.totalBytes >= received
            ? ` / ${bytes(progress.totalBytes)}`
            : ""}
          （GitHub 响应体）
        </span>
      )}
      <span>
        累计 {elapsed(now - progress.startedAt)} · 本阶段{" "}
        {elapsed(now - progress.stageAt)}
        {progress.timeoutMs
          ? ` · 单次请求预算 ${elapsed(progress.timeoutMs)}`
          : ""}
      </span>
      {progress.timeoutMs && idle >= 15_000 && (
        <span>
          已 {elapsed(idle)} 未收到新进度，仍在等待请求结果；请勿重复提交。
        </span>
      )}
      {!progress.timeoutMs && now - progress.stageAt >= 15_000 && (
        <span>仍在等待本阶段完成；本机核验或数据库操作可能需要一些时间。</span>
      )}
    </div>
  );
}
