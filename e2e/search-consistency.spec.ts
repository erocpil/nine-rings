import { expect, test } from "@playwright/test";

test("真实 Worker 搜索覆盖文档、多词和超过一页结果，移动删除后索引刷新", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const ids: string[] = [];
    for (let i = 0; i < 85; i++) {
      const note = await api.notes.create({ title: `一致性 ＡＢＣ ${i}`, date: "2026-09-09",
        content: { ops: [{ insert: "性能 needle-cross-platform\n" }] }, tags: ["ＤＰＤＫ"] });
      await api.notes.update(note.id, { storagePath: `audit/old/doc-${i}` });
      ids.push(note.id);
    }
    const search = async (query: string) => (await api.notes.searchSummaries(query)).map(note => note.id);
    const all = await search("abc 性能");
    const metadata = await search("audit/old dpdk");
    await api.docs.moveDocument(ids[0], "audit/new");
    const moved = await search("audit/new dpdk");
    const old = await search("audit/old dpdk");
    await api.recycle.batch.delete([ids[0]]);
    const deleted = await search("audit/new dpdk");
    await api.recycle.restore(ids[0]);
    const restored = await search("audit/new dpdk");
    return { all, metadata, moved, old, deleted, restored, first: ids[0] };
  });
  expect(result.all).toHaveLength(85);
  expect(result.metadata).toHaveLength(85);
  expect(result.moved).toEqual([result.first]);
  expect(result.old).toHaveLength(84);
  expect(result.deleted).toEqual([]);
  expect(result.restored).toEqual([result.first]);
  await page.getByRole("button", { name: "隐藏侧栏", exact: true }).click();
  await page.getByTitle("文档视图", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "文档视图", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "全局搜索", exact: true }).click();
  await page.locator(".search-input").fill("abc 性能");
  await expect(page.locator(".search-results-header")).toContainText("85");
  await expect(page.locator(".search-hit")).toHaveCount(80);
  await page.getByRole("button", { name: "显示更多（剩余 5）", exact: true }).click();
  await expect(page.locator(".search-hit")).toHaveCount(85);
});
