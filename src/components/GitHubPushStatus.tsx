import { useEffect } from "react";
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
  if (job.status === "idle") return null;
  return (
    <aside
      className={`github-push-status ${job.status}`}
      aria-label="GitHub 上传任务"
    >
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
          <progress aria-label="GitHub 上传进度" />
          {job.bytes !== undefined && (
            <small>
              本次请求 {(job.bytes / 1024 / 1024).toFixed(2)} MB · 超时上限{" "}
              {Math.ceil((job.timeoutMs ?? 0) / 1000)} 秒
            </small>
          )}
          <small>
            关闭设置页可继续上传；请勿关闭或刷新应用，切到系统后台可能中断。上传期间的新修改留待下次备份。
          </small>
        </>
      )}
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
