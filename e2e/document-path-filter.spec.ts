import { expect, test } from "@playwright/test";

test("路径目录可搜索文档名称和子路径，并在状态栏区分本机保存、日志与版本历史", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const longTitle = "很长的文档名称用于验证标题在路径页中可以完整显示".repeat(2);
  const longSubpath = "深层子路径名称".repeat(5);
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
      api.notes.create({ title: "很长的文档名称用于验证标题在路径页中可以完整显示".repeat(2), storagePath: `tests/path-filter/${"深层子路径名称".repeat(5)}`, date, content: { ops: [{ insert: "长名称\n" }] } }),
    ]);
  });
  await page.reload();
  const folder = page.locator(".app-sidebar .doc-tree-folder").filter({
    has: page.locator(".doc-tree-name", { hasText: /^path-filter$/ }),
  });
  await folder.locator(".doc-tree-name").click();
  await expect(page.locator(".moc-row")).toHaveCount(3);
  const longRow = page.locator(".moc-row").filter({ has: page.locator(".moc-title-text", { hasText: longTitle }) });
  await expect(longRow.locator(".moc-title-text")).toHaveText(longTitle);
  await expect(longRow.locator(".moc-title-path")).toHaveText(longSubpath);
  const longTextLayout = await longRow.locator(".moc-title-line").evaluate(element => ({
    text: getComputedStyle(element.querySelector(".moc-title-text")!).whiteSpace,
    path: getComputedStyle(element.querySelector(".moc-title-path")!).whiteSpace,
    tableWidth: element.closest("table")!.getBoundingClientRect().width,
    availableWidth: element.closest(".moc-table-wrap")!.clientWidth,
  }));
  expect(longTextLayout.text).toBe("normal");
  expect(longTextLayout.path).toBe("normal");
  expect(longTextLayout.tableWidth).toBeGreaterThanOrEqual(longTextLayout.availableWidth - 2);
  const headerAlignment = await page.locator(".moc-header").evaluate(header => ({
    buttonRight: header.querySelector(".moc-filter-toggle")!.getBoundingClientRect().right,
    headerRight: header.getBoundingClientRect().right,
  }));
  expect(headerAlignment.headerRight - headerAlignment.buttonRight).toBeLessThan(20);

  await page.getByRole("button", { name: "搜索当前路径文档" }).click();
  const input = page.getByRole("searchbox", { name: "搜索当前路径文档" });
  await input.fill("过滤目标");
  await expect(page.locator(".moc-row")).toHaveCount(1);
  await expect(page.locator(".moc-count")).toHaveText("1 / 3 篇文档");
  await input.fill("nested");
  await expect(page.locator(".moc-row")).toHaveCount(1);
  await expect(page.locator(".moc-row")).toContainText("另一份文档");
  await input.fill("没有此文档");
  await expect(page.locator(".moc-filter-empty")).toHaveText("没有匹配的文档");
  await page.getByRole("button", { name: "关闭文档搜索" }).click();
  await expect(page.locator(".moc-row")).toHaveCount(3);
  await page.locator(".moc-row").first().click();

  const status = page.locator(".editor-stats");
  await expect(status.locator(".editor-save-state")).toHaveAttribute("aria-label", "已保存到本机；GitHub 备份需要单独 Push");
  const logsButton = status.getByRole("button", { name: "打开调试日志" });
  await logsButton.click();
  await expect(status.getByRole("button", { name: "关闭调试日志" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".debug-panel")).toBeVisible();
  await status.getByRole("button", { name: "关闭调试日志" }).click();
  await status.getByRole("button", { name: "打开本机版本历史" }).click();
  await expect(page.getByRole("dialog", { name: "版本历史" })).toBeVisible();
});

test("手机选中路径后不显示空白页专用的搜索和设置行", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
    const { useNotesStore } = await import(/* @vite-ignore */ "/src/stores/useNotesStore.ts");
    await api.notes.create({ title: "路径页工具栏测试", storagePath: "tests/mobile-path-actions", date: useNotesStore.getState().currentDate, content: { ops: [{ insert: "内容\n" }] } });
  });
  await page.reload();
  const folder = page.locator(".app-sidebar .doc-tree-folder").filter({
    has: page.locator(".doc-tree-name", { hasText: /^mobile-path-actions$/ }),
  });
  await folder.locator(".doc-tree-name").click();
  await expect(page.locator(".moc-row")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".mobile-workspace-empty-actions")).toHaveCount(0);
});
