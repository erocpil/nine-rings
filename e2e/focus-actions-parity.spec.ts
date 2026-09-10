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
      const bar = page.locator(".mobile-focus-bar");
      await expect(bar).toBeVisible();
      const copy = bar.getByRole("button", { name: "复制块", exact: true });
      const tools = bar.getByRole("button", { name: "更多编辑工具", exact: true });
      await expect(copy).toBeVisible();
      await tools.click();
      await expect(tools).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(".editor-menu")).toBeVisible();
      await tools.click();
      await expect(page.locator(".editor-menu")).toBeHidden();
      const boxes = await bar.locator(":scope > button:not(.focus-readonly-toggle)").evaluateAll(buttons => buttons.map(button => {
        const r = button.getBoundingClientRect();
        return { x: r.x, width: r.width, name: button.getAttribute("aria-label") };
      }));
      const gaps = boxes.slice(1).map((box, i) => box.x - boxes[i].x - boxes[i].width);
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
      expect(new Set(boxes.map(box => box.width)).size).toBe(1);
      expect(boxes.findIndex(box => box.name === "退出专注模式")).toBeGreaterThan(boxes.findIndex(box => box.name?.startsWith("文档书签")));
      await page.locator(".ProseMirror").click();
      await copy.click();
      await expect(page.getByText(/^已复制当前块/)).toBeVisible();
      await bar.getByRole("button", { name: "点击设为只读" }).click();
      await expect(tools).toHaveCount(0);
      await expect(copy).toBeVisible();
      await bar.getByRole("button", { name: "退出专注模式" }).click();
      await expect(page.locator(".app")).not.toHaveClass(/app-focus-mode/);
      await expect(bar).toBeHidden();
    });
  });
}
