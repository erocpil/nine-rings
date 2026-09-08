import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`隐藏随笔和待办，顶部阅读入口保留文档 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() => {
      localStorage.setItem("nr:sidebarHidden", "false");
      localStorage.setItem("nr:sidebarTab", "daily");
      localStorage.setItem("nr:todoSplit", "4");
      localStorage.setItem("nr:defaultViewConfigured", "1");
      localStorage.setItem("nine_rings_config", JSON.stringify({ default_view: "daily", todo_carryover_default: true }));
    });
    await page.goto("/");
    await expect(page.locator(".note-title")).toBeVisible();
    const title = await page.locator(".note-title").inputValue();
    const header = page.locator(".sidebar-tabs");
    await expect(header.getByRole("button", { name: "文档视图", exact: true })).toBeVisible();
    const reading = header.getByRole("button", { name: "打开阅读资料库", exact: true });
    await expect(reading).toBeVisible();
    await expect(page.locator(".sidebar-reading-entry, .sidebar-view-switch, .app-main-todo, .app-main-divider, .daily-overview, .date-picker")).toHaveCount(0);
    await page.keyboard.press("Control+Shift+d");
    await expect(page.locator(".sidebar-header h2")).toHaveCount(0);
    await expect(reading).toBeVisible();
    await header.screenshot({ path: `/tmp/workspace-navigation-${width}.png` });
    // Toolbar actions must remain inside the drawer after adding the second tab.
    const headerBox = await header.boundingBox();
    for (const button of await header.getByRole("button").all()) {
      const box = await button.boundingBox();
      if (box && headerBox) expect(box.x + box.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);
    }
    await reading.click();
    await expect(page.getByRole("region", { name: "阅读资料库", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "返回笔记", exact: true }).click();
    await expect(page.locator(".note-title")).toHaveValue(title);
    await page.reload();
    await expect(page.locator(".note-title")).toHaveValue(title);
    await expect(page.locator(".app-main-todo, .app-main-divider")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:todoSplit"))).toBe("4");
    if (width < 768) await page.getByRole("button", { name: "隐藏侧栏", exact: true }).click();
    await page.getByTitle("设置", { exact: true }).click();
    await page.getByRole("button", { name: /^工作流与快捷键/ }).click();
    await expect(page.getByText("待办跨日继承", { exact: true })).toHaveCount(0);
    await expect(page.getByText("默认视图", { exact: true })).toHaveCount(0);
    await expect(page.locator(".hotkey-label").filter({ hasText: /新建随笔|快捷记录|打开每日列表/ })).toHaveCount(0);
  });
}
