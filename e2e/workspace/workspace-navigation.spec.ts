import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`移除随笔和待办，顶部阅读入口保留文档 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() => {
      localStorage.setItem("nr:sidebarHidden", "false");
    });
    await page.goto("/");
    await expect(page.locator(".note-title")).toBeVisible();
    const title = await page.locator(".note-title").inputValue();
    const header = page.locator(width >= 768 ? ".desktop-activity-bar" : ".sidebar-tabs");
    if (width >= 768) await expect(header.getByRole("button", { name: "文档树", exact: true })).toBeVisible();
    const reading = header.getByRole("button", { name: width >= 768 ? "PDF / EPUB 阅读" : "打开阅读资料库", exact: true });
    await expect(reading).toBeVisible();
    await expect(page.locator(".sidebar-reading-entry, .sidebar-view-switch, .app-main-todo, .app-main-divider, .daily-overview, .date-picker")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+d");
    await expect(page.locator(".sidebar-header h2")).toHaveCount(0);
    await expect(reading).toBeVisible();
    await header.screenshot({ path: test.info().outputPath(`workspace-navigation-${width}.png`) });
    // Mobile actions live in a horizontal scroller; each must become reachable.
    for (const button of await header.getByRole("button").all()) {
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      const headerBox = await header.boundingBox();
      if (box && headerBox) {
        expect(box.x).toBeGreaterThanOrEqual(headerBox.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);
      }
    }
    await reading.click();
    await expect(page.getByRole("region", { name: "阅读资料库", exact: true })).toBeVisible();
    await page.getByRole("button", { name: width >= 768 ? "文档树" : "切换到文档", exact: true }).click();
    await expect(page.locator(".note-title")).toHaveValue(title);
    await page.reload();
    await expect(page.locator(".note-title")).toHaveValue(title);
    await expect(page.locator(".app-main-todo, .app-main-divider")).toHaveCount(0);
    if (width < 768) await page.getByRole("button", { name: "隐藏侧栏", exact: true }).click();
    await page.keyboard.press("Alt+,");
    await page.getByRole("button", { name: /^快捷键/ }).click();
    await expect(page.getByText("待办跨日继承", { exact: true })).toHaveCount(0);
    await expect(page.getByText("默认视图", { exact: true })).toHaveCount(0);
    await expect(page.locator(".hotkey-label").filter({ hasText: /新建随笔|快捷记录|打开每日列表/ })).toHaveCount(0);
  });
}
