import { expect, test } from "@playwright/test";

for (const [width, height] of [[390, 800], [844, 390], [1280, 800]]) {
  test.describe(`专注工具 ${width}`, () => {
    test.use({ viewport: { width, height } });
    test("按钮间距、复制块与编辑工具在两端可用", async ({ page }) => {
      test.setTimeout(60000);
      await page.goto("/");
      await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
      await page.locator(".note-title").fill("专注工具测试");
      await page.locator(".ProseMirror").fill("待复制的段落");
      await page.getByRole("button", { name: "专注模式", exact: true }).click();
      // Focus controls now share the document title row in unified chrome.
      const bar = page.locator(".note-title-row");
      const copy = bar.getByRole("button", { name: "块级操作", exact: true });
      const tools = bar.getByRole("button", { name: "更多编辑工具", exact: true });
      await expect(copy).toBeVisible();
      const focusButtons = bar.locator("button.focus-btn");
      const geometry = await focusButtons.evaluateAll(buttons => buttons
        .filter(button => button.getBoundingClientRect().width > 0)
        .map(button => {
          const rect = button.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width };
        }));
      expect(geometry.length).toBeGreaterThanOrEqual(4);
      expect(geometry.every(box => box.width >= 24 && box.width <= 40)).toBe(true);
      const row = (await bar.boundingBox())!;
      for (const box of geometry) {
        expect(box.left).toBeGreaterThanOrEqual(row.x);
        expect(box.right).toBeLessThanOrEqual(row.x + row.width);
      }
      await tools.click();
      await expect(tools).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(".editor-menu")).toBeVisible();
      await tools.click();
      await expect(tools).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(".editor-menu")).toBeHidden();
      await page.locator(".ProseMirror h1, .ProseMirror p").first().click();
      await copy.click();
      const blockToolbar = page.getByRole("toolbar", { name: "块级操作" });
      await expect(blockToolbar).toBeVisible();
      await blockToolbar.getByRole("button", { name: "复制", exact: true }).click();
      await expect(page.getByText(/^已复制 1 个块/)).toBeVisible({ timeout: 5000 });
      await bar.getByRole("button", { name: "点击设为只读" }).click();
      await expect(tools).toHaveCount(0);
      await expect(copy).toBeVisible();
      await page.getByTitle("退出专注模式", { exact: true }).click();
      await expect(page.locator(".app")).not.toHaveClass(/app-focus-mode/);
      await expect(page.getByTitle("专注模式", { exact: true })).toBeVisible();
    });
  });
}
