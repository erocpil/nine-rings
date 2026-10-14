import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { api } from "../../src/lib/api";
import {
  githubApiFetch,
  pushToGitHub,
  previewPullFromGitHub,
  type SyncConfig,
} from "../../src/lib/sync/github";
import { getLogs, clearLogs } from "../../src/lib/debugLog";
import { syncErrorMessage } from "../../src/lib/sync/errors";

vi.mock("../../src/lib/runtime", () => ({ isTauriRuntime: () => true }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("../../src/lib/api", () => ({
  api: { export: { data: vi.fn(), import: vi.fn() } },
}));

const config: SyncConfig = {
  owner: "test",
  repo: "notes",
  token: "test-token",
  path: "backup.json",
  lastSyncAt: null,
  remoteSha: null,
  lastPushVersion: null,
  lastPullVersion: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.export.data).mockResolvedValue(JSON.stringify({ notes: [] }));
});
afterEach(async () => {
  // Precheck starts local export and HTTP concurrently. A local failure may
  // settle first; drain the lazy HTTP import before the next test resets mocks.
  await vi.dynamicImportSettled();
  expect(api.export.import).not.toHaveBeenCalled();
});

describe("native GitHub error boundaries", () => {
  it.each([
    ["native transport failed", "native transport failed"],
    [new Error("connection reset"), "connection reset"],
    [{ message: "permission denied" }, "permission denied"],
    [{ error: { message: "body read failed" } }, "body read failed"],
    [undefined, "未知错误"],
    [null, "未知错误"],
    ["", "未知错误"],
    [{ token: "do-not-display", payload: "private" }, "未知错误"],
  ])("normalizes IPC rejection %j", (reason, expected) => {
    expect(syncErrorMessage(reason)).toContain(expected);
    expect(syncErrorMessage(reason)).not.toContain("do-not-display");
  });

  it("does not recurse indefinitely on a cyclic error", () => {
    const reason: { cause?: unknown } = {};
    reason.cause = reason;
    expect(syncErrorMessage(reason)).toContain("未知错误");
  });

  it("preserves a native string rejection with the pointer stage", async () => {
    vi.mocked(nativeFetch).mockRejectedValue(
      "error sending request: connection reset",
    );
    await expect(previewPullFromGitHub(config)).rejects.toThrow(
      /connection reset\n失败阶段：读取远端 latest 指针\n远端路径：backup-latest/,
    );
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it("identifies snapshot download and keeps a native stream rejection", async () => {
    vi.mocked(nativeFetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "abc",
            encoding: "base64",
            content: btoa("20260916T120000"),
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error("native response body failed");
            },
          }),
        ),
      );
    await expect(previewPullFromGitHub(config)).rejects.toThrow(
      /native response body failed\n失败阶段：下载远端备份快照\n远端版本：20260916T120000/,
    );
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps structured local export failures separate from network failures", async () => {
    vi.mocked(api.export.data).mockRejectedValue({
      message: "database is locked",
    });
    vi.mocked(nativeFetch).mockResolvedValue(
      new Response("{}", { status: 404 }),
    );
    await expect(previewPullFromGitHub(config)).rejects.toThrow(
      /database is locked\n失败阶段：本机导出预检快照/,
    );
  });

  it("does not give Windows-only guidance on macOS", async () => {
    vi.mocked(nativeFetch).mockRejectedValue(new TypeError("Load failed"));
    await expect(githubApiFetch("https://api.github.com")).rejects.toThrow(
      /本机网络.*\n原始错误：Load failed/,
    );
  });
  it("records upload size, stage and GitHub request ID without credentials or body, and never publishes after HTTP 400", async () => {
    clearLogs();
    const source = JSON.stringify({ notes: [], privateBody: "正文测试" });
    vi.mocked(api.export.data).mockResolvedValue(source);
    vi.mocked(nativeFetch)
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "malformed request" }), {
          status: 400,
          headers: { "x-github-request-id": "ABCD:1234:5678" },
        }),
      );
    await expect(pushToGitHub(config)).rejects.toThrow(
      /GitHub PUT 400:[\s\S]*上传备份数据[\s\S]*请求大小：[\s\S]*ABCD:1234:5678/,
    );
    expect(nativeFetch).toHaveBeenCalledTimes(2);
    const request = vi.mocked(nativeFetch).mock.calls[1][1]!;
    expect(new Headers(request.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(JSON.parse(String(request.body)).content).toBe(
      btoa(unescape(encodeURIComponent(source))),
    );
    const logs = getLogs()
      .map((entry) => entry.msg)
      .join("\n");
    expect(logs).toContain("Tauri 原生 HTTP");
    expect(logs).toContain("HTTP 400");
    expect(logs).toContain("ABCD:1234:5678");
    expect(logs).not.toContain(config.token);
    expect(logs).not.toContain("正文测试");
  });
});
