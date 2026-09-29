import { expect, test } from "@playwright/test";

test("路径目录可搜索文档名称和子路径，并在状态栏区分本机保存、日志与版本历史", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const [{ api }, { useNotesStore }] = await Promise.all([
      load("/src/lib/api.ts"),
      load("/src/stores/useNotesStore.ts"),
    ]);
    const date = useNotesStore.getState().currentDate;
    await Promise.all([
      api.notes.create({ title: "过滤目标文档", storagePath: "tests/path-filter", date, content: { ops: [{ insert: "目标\n" }] } }),
      api.notes.create({ title: "另一份文档", storagePath: "tests/path-filter/nested", date, content: { ops: [{ insert: "其它\n" }] } }),
    ]);
  });
  await page.reload();
  const folder = page.locator(".app-sidebar .doc-tree-folder").filter({
    has: page.locator(".doc-tree-name", { hasText: /^path-filter$/ }),
  });
  await folder.locator(".doc-tree-name").click();
  await expect(page.locator(".moc-row")).toHaveCount(2);

  await page.getByRole("button", { name: "搜索当前路径文档" }).click();
  const input = page.getByRole("searchbox", { name: "搜索当前路径文档" });
  await input.fill("过滤目标");
  await expect(page.locator(".moc-row")).toHaveCount(1);
  await expect(page.locator(".moc-count")).toHaveText("1 / 2 篇文档");
  await input.fill("nested");
  await expect(page.locator(".moc-row")).toHaveCount(1);
  await expect(page.locator(".moc-row")).toContainText("另一份文档");
  await input.fill("没有此文档");
  await expect(page.locator(".moc-filter-empty")).toHaveText("没有匹配的文档");
  await page.getByRole("button", { name: "关闭文档搜索" }).click();
  await expect(page.locator(".moc-row")).toHaveCount(2);
  await page.locator(".moc-row").first().click();

  const status = page.locator(".editor-stats");
  await expect(status.getByText("本机已保存")).toBeVisible();
  const logsButton = status.getByRole("button", { name: "打开调试日志" });
  await logsButton.click();
  await expect(status.getByRole("button", { name: "关闭调试日志" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".debug-panel")).toBeVisible();
  await status.getByRole("button", { name: "关闭调试日志" }).click();
  await status.getByRole("button", { name: "打开本机版本历史" }).click();
  await expect(page.getByRole("dialog", { name: "版本历史" })).toBeVisible();
});
