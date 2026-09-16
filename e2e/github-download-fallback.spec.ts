import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

test("原生响应流解码失败后 WebView 完整下载大响应且不拼接损坏片段", async ({ page }) => {
  const url = "https://api.github.com/repos/test/notes/git/blobs/snapshot";
  const payload = "中文备份与多行正文\n".repeat(100_000);
  let reads = 0;
  await page.route(url, async route => {
    reads++;
    expect(route.request().method()).toBe("GET");
    expect(route.request().headers().authorization).toBe("Bearer dummy-token");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ payload }) });
  });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const result = await page.evaluate(async url => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { githubApiFetch } = await load("/src/lib/sync/github.ts");
    const target = window as Window & { __TAURI_INTERNALS__?: unknown };
    const previous = target.__TAURI_INTERNALS__;
    let chunks = 0;
    let closed = 0;
    target.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "plugin:http|fetch") return 41;
      if (command === "plugin:http|fetch_send") return { status: 200, statusText: "OK", url, headers: [], rid: 42 };
      if (command === "plugin:http|fetch_read_body") {
        if (++chunks === 1) return [...new TextEncoder().encode("corrupt-partial-body"), 0];
        throw "error decoding response body";
      }
      if (command === "plugin:http|fetch_cancel_body") { closed++; return; }
      throw new Error(`Unexpected native command: ${command}`);
    } };
    try {
      const response = await githubApiFetch(url, { headers: { Authorization: "Bearer dummy-token" } });
      const { payload } = await response.json();
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
      return { chunks, closed, hash: Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("") };
    } finally {
      if (previous === undefined) delete target.__TAURI_INTERNALS__;
      else target.__TAURI_INTERNALS__ = previous;
    }
  }, url);
  expect(result).toEqual({ chunks: 2, closed: 1, hash: createHash("sha256").update(payload).digest("hex") });
  expect(reads).toBe(1);
});
