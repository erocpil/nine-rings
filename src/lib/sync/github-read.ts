/** Shared GET-only transport for fixed-revision inspection and recovery. */
import { githubApiFetch } from "./github";
import { githubTransferTimeoutMs } from "./github-timeout";
import { addLog } from "../debugLog";
import { isTauriRuntime } from "../runtime";

export interface GitReadOptions {
  expectedBytes?: number;
}
export function githubReadBudget(route: string, expectedBytes?: number) {
  if (!route.startsWith("/git/blobs/")) return 20_000;
  if (
    expectedBytes !== undefined &&
    (!Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 0 ||
      expectedBytes > 64 * 1024 * 1024)
  )
    throw Error("备份正文读取大小超出预算");
  return githubTransferTimeoutMs(
    expectedBytes === undefined ? 0 : Math.ceil(expectedBytes / 3) * 4 + 512,
  );
}
function phase(route: string) {
  if (route.startsWith("/git/blobs/")) return "备份正文/控制文件 Blob";
  if (route.startsWith("/git/trees/")) return "Git 目录";
  if (route.startsWith("/git/commits/")) return "Git 提交";
  if (route.startsWith("/git/ref/")) return "分支 HEAD";
  return "仓库信息";
}
export async function githubReadJson(
  config: { owner: string; repo: string; token: string },
  route: string,
  options: GitReadOptions = {},
): Promise<unknown> {
  if (
    (route !== "" && !route.startsWith("/")) ||
    route.startsWith("//") ||
    /[?#]/.test(route) ||
    route.split("/").includes("..")
  )
    throw Error("无效 Git 读取路径");
  const root = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const timeout = githubReadBudget(route, options.expectedBytes);
  const label = phase(route);
  const transport = isTauriRuntime() ? "Tauri 原生 HTTP" : "浏览器";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = performance.now();
    // Log large transfers, retries and failures; avoid flooding hundreds of metadata GETs.
    if (
      route.startsWith("/git/blobs/") &&
      (options.expectedBytes ?? 0) >= 1024 * 1024
    )
      addLog(
        `[Sync] 读取${label} | 原文: ${options.expectedBytes} bytes | 超时: ${timeout / 1000}s | 通道: ${transport} | 尝试: ${attempt}/2`,
      );
    try {
      const response = await githubApiFetch(
        root + route,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
        timeout,
      );
      if (!response.ok)
        throw Object.assign(Error(`读取${label} HTTP ${response.status}`), {
          status: response.status,
        });
      const value = await response.json();
      if (
        route.startsWith("/git/blobs/") &&
        (options.expectedBytes ?? 0) >= 1024 * 1024
      )
        addLog(
          `[Sync] 读取${label}完成 | 耗时: ${Math.round(performance.now() - started)}ms`,
        );
      return value;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "请求失败";
      const retryable = /^(GitHub 请求超时|无法连接 GitHub API)/.test(message);
      addLog(
        `[Sync] 读取${label}失败 | 通道: ${transport} | 耗时: ${Math.round(performance.now() - started)}ms | 尝试: ${attempt}/2${retryable && attempt === 1 ? " | 仅重试本次 GET" : ""}`,
      );
      if (retryable && attempt === 1) continue;
      const error = Object.assign(
        Error(
          `读取${label}失败（${transport}，超时预算 ${timeout / 1000} 秒）：${message}`,
        ),
        typeof reason === "object" && reason !== null && "status" in reason
          ? { status: reason.status }
          : {},
      );
      throw error;
    }
  }
  throw Error("GitHub 只读请求未完成");
}
