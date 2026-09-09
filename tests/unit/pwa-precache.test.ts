import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceWorkerSource } from "../../plugins/vite-pwa-plugin";

type CacheWriter = {
  put: (request: Request, response: Response) => Promise<void>;
};
function worker(fetcher: typeof fetch, extra: Record<string, unknown> = {}) {
  return runInNewContext(
    createServiceWorkerSource([], "test-body-download") +
      "\n({cacheResource, installVersion});",
    {
      Request: class extends Request {
        constructor(url: string, init?: RequestInit) {
          super(new URL(url, "https://example.test"), init);
        }
      },
      Response,
      Headers,
      AbortController,
      setTimeout,
      clearTimeout,
      fetch: fetcher,
      self: { addEventListener() {}, clients: { matchAll: async () => [] } },
      ...extra,
    },
  ) as {
    cacheResource: (cache: CacheWriter, url: string) => Promise<void>;
    installVersion: () => Promise<void>;
  };
}

describe("generated service worker precache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries a timed-out body after HTTP 200 before writing the cache", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        async (_request, init) =>
          new Response(
            new ReadableStream({
              start(controller) {
                init!.signal!.addEventListener("abort", () =>
                  controller.error(
                    new DOMException("Fetch is aborted", "AbortError"),
                  ),
                );
              },
            }),
            { headers: { "content-type": "image/png" } },
          ),
      )
      .mockImplementation(async () => new Response("complete"));
    const put = vi.fn(async (_request: Request, response: Response) => {
      expect(await response.text()).toBe("complete");
    });
    const result = worker(fetcher).cacheResource({ put }, "/icon-192.png");
    await vi.runAllTimersAsync();
    await result;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("clears the network timer before a slow CacheStorage write", async () => {
    let signal: AbortSignal | undefined;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_request, init) => {
        signal = init?.signal ?? undefined;
        return new Response("decoded", {
          headers: {
            "content-type": "image/png",
            "content-encoding": "gzip",
            "content-length": "999",
          },
        });
      });
    const put = vi.fn(async (_request: Request, response: Response) => {
      await new Promise((resolve) => setTimeout(resolve, 20000));
      expect(signal?.aborted).toBe(false);
      expect(await response.text()).toBe("decoded");
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.has("content-encoding")).toBe(false);
      expect(response.headers.has("content-length")).toBe(false);
    });
    const result = worker(fetcher).cacheResource({ put }, "/icon-192.png");
    await vi.runAllTimersAsync();
    await result;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries a transient cache AbortError", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("complete"));
    const put = vi
      .fn<CacheWriter["put"]>()
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
      .mockResolvedValue(undefined);
    const result = worker(fetcher).cacheResource({ put }, "/icon-192.png");
    await vi.runAllTimersAsync();
    await result;
    expect(put).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent storage quota failures", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("complete"));
    const put = vi
      .fn<CacheWriter["put"]>()
      .mockRejectedValue(new DOMException("full", "QuotaExceededError"));
    await expect(
      worker(fetcher).cacheResource({ put }, "/icon-192.png"),
    ).rejects.toThrow(
      "stage=cache-write status=200 attempt=1 timeout=false QuotaExceededError",
    );
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("reports persistent body failures as body-read with three attempts", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(
                new DOMException("Fetch is aborted", "AbortError"),
              );
            },
          }),
        ),
    );
    const put = vi.fn<CacheWriter["put"]>();
    const checking = expect(
      worker(fetcher).cacheResource({ put }, "/icon-192.png"),
    ).rejects.toThrow(
      "stage=body-read status=200 attempt=3 timeout=false AbortError",
    );
    await vi.runAllTimersAsync();
    await checking;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(put).not.toHaveBeenCalled();
  });

  it("settles all writers before deleting only the failed build cache", async () => {
    let writes = 0;
    const cache: CacheWriter = {
      put: async (request) => {
        if (new URL(request.url).pathname === "/icon-192.png")
          throw new DOMException("full", "QuotaExceededError");
        writes++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        writes--;
      },
    };
    const remove = vi.fn(async (name: string) => {
      expect(writes).toBe(0);
      expect(name).not.toBe("nine-rings-active");
      return true;
    });
    const open = vi
      .fn<(name: string) => Promise<CacheWriter>>()
      .mockResolvedValue(cache);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("complete"));
    const checking = expect(
      worker(fetcher, { caches: { open, delete: remove } }).installVersion(),
    ).rejects.toThrow("QuotaExceededError");
    await vi.runAllTimersAsync();
    await checking;
    expect(remove).toHaveBeenCalledExactlyOnceWith(open.mock.calls[0]?.[0]);
  });
});
