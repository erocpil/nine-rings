import { beforeEach, expect, it, vi } from "vitest";
const fetch = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/sync/github", () => ({ githubApiFetch: fetch }));
vi.mock("../../src/lib/debugLog", () => ({ addLog: vi.fn() }));
import {
  githubReadBudget,
  githubReadJson,
} from "../../src/lib/sync/github-read";
import { githubTransferTimeoutMs } from "../../src/lib/sync/github-timeout";
const config = { owner: "example", repo: "backup", token: "TEST_ONLY" };
beforeEach(() => {
  fetch.mockReset();
});
it("budgets a 23 MB snapshot by Base64 transfer bytes instead of the metadata deadline", async () => {
  const bytes = 23_293_243;
  const budget = githubReadBudget("/git/blobs/abc", bytes);
  expect(budget).toBe(githubTransferTimeoutMs(Math.ceil(bytes / 3) * 4 + 512));
  expect(budget).toBeGreaterThan(120_000);
  expect(budget).toBeLessThanOrEqual(600_000);
  expect(githubReadBudget("/git/commits/abc", bytes)).toBe(20_000);
  fetch.mockResolvedValue(new Response('{"ok":true}'));
  expect(
    await githubReadJson(config, "/git/blobs/abc", { expectedBytes: bytes }),
  ).toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/git/blobs/abc"),
    expect.objectContaining({ method: "GET" }),
    budget,
  );
});
it("retries only the failed read once after a timeout", async () => {
  fetch
    .mockRejectedValueOnce(Error("GitHub 请求超时（20 秒）"))
    .mockResolvedValueOnce(new Response('{"ok":true}'));
  expect(await githubReadJson(config, "/git/ref/heads/main")).toEqual({
    ok: true,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every((call) => call[1].method === "GET")).toBe(true);
});
it("stops after two network failures and identifies the failing request", async () => {
  fetch.mockRejectedValue(Error("无法连接 GitHub API。"));
  await expect(githubReadJson(config, "/git/trees/abc")).rejects.toThrow(
    "读取Git 目录失败",
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([401, 403, 404, 429, 500])(
  "never silently retries HTTP %i",
  async (status) => {
    fetch.mockResolvedValue(new Response("{}", { status }));
    await expect(githubReadJson(config, "")).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it("does not retry cancellation or malformed JSON", async () => {
  fetch.mockRejectedValueOnce(Error("GitHub 请求已取消"));
  await expect(githubReadJson(config, "")).rejects.toThrow("已取消");
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockReset().mockResolvedValue(new Response("not-json"));
  await expect(githubReadJson(config, "/git/blobs/abc")).rejects.toThrow(
    "Blob",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects oversized body hints before issuing a request", async () => {
  await expect(
    githubReadJson(config, "/git/blobs/abc", {
      expectedBytes: 64 * 1024 * 1024 + 1,
    }),
  ).rejects.toThrow("超出预算");
  expect(fetch).not.toHaveBeenCalled();
});
