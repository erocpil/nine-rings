import { create } from "zustand";
import type { PushProgress, SyncConfig } from "./github";
import { GitHubWriteHttpError } from "./errors";

interface PushJob {
  status: "idle" | "running" | "success" | "error" | "cancelled";
  phase: "preparing" | PushProgress["phase"];
  target: string;
  bytes?: number;
  timeoutMs?: number;
  requestStartedAt?: number;
  message: string;
  cancelRequested: boolean;
  result: SyncConfig | null;
}

// Application-owned, not SettingsSync-owned. Never persist credentials in this store.
export const useGitHubPushJob = create<PushJob>(() => ({
  status: "idle",
  phase: "preparing",
  target: "",
  message: "",
  cancelRequested: false,
  result: null,
}));
let activeController: AbortController | null = null;

export function pushSnapshotBusy(job: PushJob): boolean {
  return (
    job.status === "running" &&
    ["preparing", "checking", "exporting"].includes(job.phase)
  );
}

export async function startGitHubPush(
  config: SyncConfig,
  beforeSnapshot?: () => Promise<void>,
): Promise<void> {
  if (activeController) return;
  const controller = new AbortController();
  activeController = controller;
  const snapshotConfig = { ...config };
  useGitHubPushJob.setState({
    status: "running",
    phase: "preparing",
    target: `${config.owner}/${config.repo}`,
    bytes: undefined,
    timeoutMs: undefined,
    requestStartedAt: undefined,
    message: "",
    cancelRequested: false,
    result: null,
  });
  try {
    await beforeSnapshot?.();
    const { pushToGitHub } = await import("./github");
    const result = await pushToGitHub(snapshotConfig, undefined, {
      signal: controller.signal,
      onProgress: (progress) =>
        useGitHubPushJob.setState({
          ...progress,
          requestStartedAt: Date.now(),
        }),
    });
    useGitHubPushJob.setState({
      status: "success",
      message: `备份已上传至 GitHub（${new Date().toLocaleTimeString()}），版本 ${result.lastPushVersion}`,
      result: { ...result, token: "" },
    });
  } catch (error) {
    const phase = useGitHubPushJob.getState().phase;
    const rejected =
      error instanceof GitHubWriteHttpError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408;
    const uncertain =
      rejected && phase === "publishing"
        ? "数据文件已上传，但最新备份发布请求被拒绝。"
        : rejected && phase === "uploading"
          ? "数据文件上传请求被拒绝，未进入最新备份发布步骤。"
          : phase === "publishing"
            ? "最新指针可能已写入；请先检查远端状态，必要时 Pull 安全合并，不要直接重复上传。"
            : phase === "uploading"
              ? "远端可能已保存数据文件，但尚未发布为最新备份。"
              : "";
    useGitHubPushJob.setState({
      status: controller.signal.aborted ? "cancelled" : "error",
      message: `${controller.signal.aborted ? "上传已取消" : `上传失败：${error instanceof Error ? error.message : String(error)}`}。${uncertain}`,
    });
  } finally {
    activeController = null;
  }
}

export function cancelGitHubPush(): void {
  if (!activeController) return;
  useGitHubPushJob.setState({ cancelRequested: true });
  activeController.abort();
}

export function dismissGitHubPush(): void {
  if (useGitHubPushJob.getState().status !== "running")
    useGitHubPushJob.setState({ status: "idle" });
}
