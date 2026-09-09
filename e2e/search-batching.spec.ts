import { expect, test } from "@playwright/test";

test("真实 Worker 分批构建不遗漏尾批，重建空索引清除旧结果", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  const results = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const search = await load("/src/lib/web-search-index.ts") as typeof import("../src/lib/web-search-index");
    let notes = Array.from({ length: 751 }, (_, i) => ({
      id: `batch-${i}`, title: `批次 ${i}`, date: "2026-09-09", content: { ops: [{ insert: "共同关键词" }] },
      tags: [], pinned: false, readonly: false, sort_order: 0, storagePath: "batch/docs", created_at: "2026-09-09", updated_at: "2026-09-09",
    }));
    const adapter = { getAllNotes: async () => [], searchDocs: async () => notes } as unknown as import("../src/lib/storage/types").StorageAdapter;
    search.invalidateWebSearchIndex();
    const all = await search.searchWebNoteSummaries(adapter, "共同关键词");
    const tail = await search.searchWebNoteSummaries(adapter, "批次 750");
    search.invalidateWebSearchIndex();
    notes = [];
    const empty = await search.searchWebNoteSummaries(adapter, "共同关键词");
    search.invalidateWebSearchIndex();
    return { count: all.length, unique: new Set(all.map(n => n.id)).size, tail: tail.map(n => n.id), empty };
  });
  expect(results).toEqual({ count: 751, unique: 751, tail: ["batch-750"], empty: [] });
});
