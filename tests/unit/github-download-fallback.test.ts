import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { githubApiFetch } from "../../src/lib/sync/github";

vi.mock("../../src/lib/runtime", () => ({ isTauriRuntime: () => true }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

const url = "https://api.github.com/repos/test/notes/git/blobs/abc";
const decodeError = "error decoding response body";
const webFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", webFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("native download recovery", () => {
  it("discards the partial native body and reads a complete WebView response once", async () => {
    vi.mocked(nativeFetch).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode("partial-corrupt-body"),
            );
          },
          pull(controller) {
            controller.error(decodeError);
          },
        }),
      ),
    );
    webFetch.mockResolvedValue(new Response('{"content":"valid"}'));
    const headers = {
      Authorization: "Bearer dummy-token",
      Accept: "application/vnd.github+json",
    };
    const response = await githubApiFetch(url, { headers });
    expect(await response.json()).toEqual({ content: "valid" });
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(webFetch).toHaveBeenCalledTimes(1);
    expect(webFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        headers,
        credentials: "omit",
        redirect: "error",
      }),
    );
    expect(webFetch.mock.calls[0][1]?.signal).toBe(
      vi.mocked(nativeFetch).mock.calls[0][1]?.signal,
    );
  });

  it.each(["PUT", "POST", "PATCH", "DELETE"])(
    "never replays a %s write",
    async (method) => {
      vi.mocked(nativeFetch).mockRejectedValue(decodeError);
      await expect(githubApiFetch(url, { method, body: "{}" })).rejects.toThrow(
        decodeError,
      );
      expect(webFetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    "https://example.com/file",
    "https://api.github.com.evil.test/file",
    "http://api.github.com/file",
  ])("does not expand the allowed origin: %s", async (other) => {
    vi.mocked(nativeFetch).mockRejectedValue(decodeError);
    await expect(githubApiFetch(other)).rejects.toThrow(decodeError);
    expect(webFetch).not.toHaveBeenCalled();
  });

  it.each([
    "url not allowed on the configured scope",
    "url not allowed on the configured scope: error decoding response body",
    "certificate verify failed",
    "connection reset",
  ])("does not bypass other native failures: %s", async (reason) => {
    vi.mocked(nativeFetch).mockRejectedValue(reason);
    await expect(githubApiFetch(url)).rejects.toThrow(reason);
    expect(webFetch).not.toHaveBeenCalled();
  });

  it("does not retry a valid HTTP error response", async () => {
    vi.mocked(nativeFetch).mockResolvedValue(
      new Response("denied", { status: 403 }),
    );
    expect((await githubApiFetch(url)).status).toBe(403);
    expect(webFetch).not.toHaveBeenCalled();
  });

  it("keeps both errors if WebView recovery also fails, without further retries", async () => {
    vi.mocked(nativeFetch).mockRejectedValue(decodeError);
    webFetch.mockRejectedValue(new TypeError("Load failed"));
    await expect(githubApiFetch(url)).rejects.toThrow(
      /原生下载：error decoding response body\nWebView 重试：Load failed/,
    );
    expect(webFetch).toHaveBeenCalledTimes(1);
  });

  it("does not reset the original deadline when switching transports", async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(nativeFetch).mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(decodeError), 75);
          started();
        }),
    );
    webFetch.mockImplementation(() => new Promise(() => {}));
    const result = expect(githubApiFetch(url, {}, 100)).rejects.toThrow(
      "GitHub 请求超时",
    );
    await ready;
    await vi.advanceTimersByTimeAsync(75);
    expect(webFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25);
    await result;
    expect(webFetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("cancels a stalled fallback body and releases its stream lock", async () => {
    vi.mocked(nativeFetch).mockRejectedValue(decodeError);
    const cancel = vi.fn();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const body = new ReadableStream({ cancel });
    webFetch.mockImplementation(async () => {
      started();
      return new Response(body);
    });
    const caller = new AbortController();
    const result = expect(
      githubApiFetch(url, { signal: caller.signal }),
    ).rejects.toThrow("GitHub 请求已取消");
    await ready;
    // Let the response reader attach before the caller aborts.
    await Promise.resolve();
    caller.abort();
    await result;
    await vi.waitFor(() => {
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    });
  });
});
