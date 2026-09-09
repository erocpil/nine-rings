import { expect, test } from "@playwright/test";

test.skip(process.env.NR_SEARCH_BENCHMARK !== "1", "显式运行的性能诊断，不以机器相关耗时作为 CI 门槛");

test("大资料库搜索冷启动与热查询基线", async ({ page, browserName }) => {
  test.setTimeout(120000);
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  const results = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const search = await load("/src/lib/web-search-index.ts") as typeof import("../src/lib/web-search-index");
    const body = "性能测量段落 English words 网络检索。".repeat(140);
    const notes = Array.from({ length: 5000 }, (_, i) => ({
      id: `bench-${i}`, title: `文档 ${i}`, date: "2026-09-09", content: { ops: [{ insert: `${body}\nneedle-${i}\n` }] },
      tags: [], pinned: false, readonly: false, sort_order: 0, storagePath: "bench/docs", created_at: "2026-09-09", updated_at: "2026-09-09",
    }));
    // Isolate index preparation, structured clone and Worker work from storage
    // I/O; adapters return synthetic in-memory documents, never user data.
    const adapter = { getAllNotes: async () => [], searchDocs: async () => notes } as unknown as import("../src/lib/storage/types").StorageAdapter;
    const rounds = [];
    for (let round = 0; round < 3; round++) {
      search.invalidateWebSearchIndex();
      let maxFrameGapMs = 0, previous = performance.now(), frame = 0;
      const tick = () => { const now = performance.now(); maxFrameGapMs = Math.max(maxFrameGapMs, now - previous); previous = now; frame = requestAnimationFrame(tick); };
      frame = requestAnimationFrame(tick);
      const start = performance.now();
      const cold = await search.searchWebNoteSummaries(adapter, "needle-4999");
      const coldMs = performance.now() - start;
      await new Promise(requestAnimationFrame);
      cancelAnimationFrame(frame);
      const warmStart = performance.now();
      const warm = await search.searchWebNoteSummaries(adapter, "needle-4999");
      const warmMs = performance.now() - warmStart;
      const broadStart = performance.now();
      const broad = await search.searchWebNoteSummaries(adapter, "性能");
      const broadMs = performance.now() - broadStart;
      rounds.push({ coldMs, warmMs, broadMs, maxFrameGapMs, coldCount: cold.length, warmCount: warm.length, broadCount: broad.length });
    }
    search.invalidateWebSearchIndex();
    return { count: notes.length, bodyCharacters: body.length, rounds };
  });
  for (const round of results.rounds) {
    expect(round.coldCount).toBe(1);
    expect(round.warmCount).toBe(1);
    expect(round.broadCount).toBe(5000);
  }
  console.log("SEARCH_BENCHMARK", JSON.stringify({ browserName, ...results }));
});
