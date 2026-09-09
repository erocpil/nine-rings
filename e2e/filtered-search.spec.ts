import { expect, test } from "@playwright/test";

test("全局搜索增加路径类型概念筛选后保留多词匹配，清除关键词可仅按条件查询", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    for (const [title, storagePath, docType, concept] of [
      ["筛选验证 ＡＢＣ", "projects/search", "reference", "网络"],
      ["其它类型 ＡＢＣ", "projects/search", "tutorial", "网络"],
      ["其它概念 ＡＢＣ", "projects/search", "reference", "网络安全"],
      ["相似路径 ＡＢＣ", "projects-other/search", "reference", "网络"],
    ] as const) await api.notes.create({ title, storagePath, docType, concepts: [concept], date: "2026-09-09", content: { ops: [{ insert: "性能 uniquefilterbody\n" }] } });
  });
  await page.reload();
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await page.keyboard.press("Control+Shift+f");
  const input = page.locator(".search-input");
  await input.fill("abc uniquefilterbody");
  await expect(page.locator(".search-hit")).toHaveCount(4);
  await page.locator(".search-filter-btn").click();
  await page.locator(".search-filter-select").selectOption("projects");
  await expect(page.locator(".search-hit")).toHaveCount(3);
  await page.locator(".search-filter-chip").filter({ hasText: "参考" }).click();
  await expect(page.locator(".search-hit")).toHaveCount(2);
  await page.getByPlaceholder("概念...").fill("网络");
  await page.locator(".search-filter-suggestion").getByText("网络", { exact: true }).click();
  await expect(page.locator(".search-hit")).toHaveCount(1);
  await expect(page.locator(".search-hit")).toContainText("筛选验证");
  await input.fill("");
  await expect(page.locator(".search-hit mark")).toHaveCount(0);
  await expect(page.locator(".search-hit")).toHaveCount(1);
  await expect(page.locator(".search-hit")).toContainText("筛选验证");
  // Queue another debounced query, then immediately open an existing result.
  // Its timer must not put the search panel back over the opened document.
  await input.fill("uniquefilterbody");
  await page.locator(".search-hit").click();
  await expect(page.locator(".note-title")).toHaveValue("筛选验证 ＡＢＣ");
  await page.waitForTimeout(350);
  await expect(page.locator(".search-results")).toHaveCount(0);
});
