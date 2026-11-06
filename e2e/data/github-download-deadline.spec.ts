import { expect, test } from "@playwright/test";

for (const scenario of ["idle", "resume"] as const) {
  test(`GitHub 正文${scenario === "idle" ? "停滞" : "恢复后超期"}及时结束且不重放请求`, async ({ page }) => {
    await page.clock.install();
    await page.route("**/__download-deadline-test", route => route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><meta charset=utf-8>",
    }));
    await page.goto("/__download-deadline-test");
    await page.evaluate(async () => {
      const { githubApiFetch } = await import("/src/lib/sync/github.ts");
      const state = globalThis as unknown as {
        downloadResult: Promise<string>;
        downloadCancelled: boolean;
        downloadRequests: number;
      };
      state.downloadRequests = 0;
      state.downloadCancelled = false;
      const original = globalThis.fetch;
      globalThis.fetch = async () => {
        state.downloadRequests++;
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode("partial")); },
          cancel() { state.downloadCancelled = true; },
        }));
      };
      state.downloadResult = githubApiFetch("https://api.github.com/repos/test/backup/git/blobs/test", {}, 600_000)
        .then(() => "unexpected-success", error => String(error.message))
        .finally(() => { globalThis.fetch = original; });
    });
    if (scenario === "idle") {
      await page.clock.runFor(61_000);
    } else {
      await page.clock.setSystemTime(Date.now() + 900_000);
      await page.evaluate(() => globalThis.dispatchEvent(new Event("focus")));
    }
    const result = await page.evaluate(async () => {
      const state = globalThis as unknown as {
        downloadResult: Promise<string>;
        downloadCancelled: boolean;
        downloadRequests: number;
      };
      return { message: await state.downloadResult, cancelled: state.downloadCancelled, requests: state.downloadRequests };
    });
    expect(result.message).toContain(scenario === "idle" ? "正文连续 60 秒无新数据" : "600 秒");
    expect(result.message).toContain("本次只读请求未写入远端");
    expect(result.message).toContain("已接收 7 bytes");
    expect(result.cancelled).toBe(true);
    expect(result.requests).toBe(1);
  });
}
