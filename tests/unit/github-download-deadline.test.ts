import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { githubApiFetch } from "../../src/lib/sync/github";

vi.mock("../../src/lib/runtime", () => ({ isTauriRuntime: () => false }));
const url = "https://api.github.com/repos/test/backup/git/blobs/test";
let body: ReadableStreamDefaultController<Uint8Array>;
let cancelled: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  cancelled = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              body = controller;
              controller.enqueue(new TextEncoder().encode("partial"));
            },
            cancel: cancelled,
          }),
        ),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("ends a stalled GET body after 60 seconds, cancels the stream and releases all timers", async () => {
  const result = expect(githubApiFetch(url, {}, 600_000)).rejects.toThrow(
    "正文连续 60 秒无新数据",
  );
  await vi.advanceTimersByTimeAsync(60_000);
  await result;
  expect(cancelled).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("checks elapsed wall time after suspension rather than waiting for the original timer", async () => {
  const result = expect(githubApiFetch(url, {}, 600_000)).rejects.toThrow(
    "600 秒",
  );
  await vi.advanceTimersByTimeAsync(1);
  vi.setSystemTime(Date.now() + 900_000);
  await vi.advanceTimersByTimeAsync(1000);
  await result;
  expect(cancelled).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("allows slow downloads that keep making progress and cleans up after success", async () => {
  const result = githubApiFetch(url, {}, 600_000);
  await vi.advanceTimersByTimeAsync(30_000);
  body.enqueue(new TextEncoder().encode("-more"));
  await vi.advanceTimersByTimeAsync(30_000);
  body.close();
  expect(await (await result).text()).toBe("partial-more");
  expect(cancelled).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not apply the GET idle rule or replay an uncertain write", async () => {
  const result = githubApiFetch(url, { method: "POST", body: "{}" }, 120_000);
  const failure =
    expect(result).rejects.toThrow("写请求超时不代表远端一定未写入");
  await vi.advanceTimersByTimeAsync(61_000);
  expect(cancelled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(59_000);
  await failure;
  expect(fetch).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
