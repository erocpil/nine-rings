import { useEffect, useState } from "react";
import { SyncLogDialog } from "./SyncLogDialog";
import {
  cancelGitHubPush,
  dismissGitHubPush,
  useGitHubPushJob,
} from "../lib/sync/push-job";

const PHASE_LABELS = {
  preparing: "正在保存当前修改…",
  checking: "正在检查远端版本…",
  exporting: "正在准备备份快照…",
  uploading: "正在上传备份数据…",
  publishing: "正在发布最新备份…",
};

export function GitHubPushStatus() {
  const [logsOpen, setLogsOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const job = useGitHubPushJob();
  const running = job.status === "running";
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (job.status === "idle") return null;
  return (
    <aside
      className={`github-push-status ${job.status}`}
      aria-label="GitHub 上传任务"
    >
      {logsOpen && <SyncLogDialog onClose={() => setLogsOpen(false)} />}
      <div role="status" aria-live="polite" aria-atomic="true">
        <strong>
          {running
            ? job.cancelRequested
              ? "正在取消上传…"
              : PHASE_LABELS[job.phase]
            : job.message}
        </strong>
        <small>{job.target}</small>
      </div>
      {running && (
        <>
          <progress aria-label="GitHub 请求进行中" />
          {job.bytes !== undefined && (
            <small>
              本次请求 {(job.bytes / 1024 / 1024).toFixed(2)} MB · 超时上限{" "}
              {Math.ceil((job.timeoutMs ?? 0) / 1000)} 秒
            </small>
          )}
          {job.requestStartedAt !== undefined && (
            <small>
              当前请求已等待 {Math.max(0, Math.floor((now - job.requestStartedAt) / 1000))} 秒
            </small>
          )}
          <small>
            上传过程中暂不提供可靠的逐字节进度；这里显示本次请求大小和等待时间，收到响应后会更新阶段。
          </small>
          <small>
            关闭设置页可继续上传；请勿关闭或刷新应用，切到系统后台可能中断。上传期间的新修改留待下次备份。
          </small>
        </>
      )}
      {(job.status === "error" || job.status === "cancelled") && <button type="button" className="settings-btn" onClick={() => setLogsOpen(true)}>查看同步日志</button>}
      <button
        className="settings-btn"
        onClick={running ? cancelGitHubPush : dismissGitHubPush}
        disabled={running && job.cancelRequested}
      >
        {running ? "取消上传" : "关闭提示"}
      </button>
    </aside>
  );
}
