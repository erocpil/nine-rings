import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("更多菜单跟随实际工具溢出，不重复工具栏入口", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  for (const viewport of [{ width: 320, height: 844 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.getByTitle("更多编辑操作", { exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "更多编辑操作", exact: true });
    await expect(sheet).toBeVisible();
    for (const [tool, label] of [["clipboard", "复制"], ["size", "文字字号"], ["font", "缩小编辑器字号"]]) {
      const hidden = await page.locator(`[data-toolbar-tool="${tool}"]`).getAttribute("data-toolbar-overflow") === "true";
      await expect(sheet.getByText(label, { exact: true })).toHaveCount(hidden ? 1 : 0);
    }
    await expect(sheet.getByText(/书签列表/)).toHaveCount(0);
    expect(await sheet.locator(".menu-dropdown-item").evaluateAll(items => items.every(el => el.querySelector("svg.toolbar-icon")))).toBe(true);
    const color = sheet.getByLabel("文字颜色", { exact: true });
    expect((await color.boundingBox())!.width).toBeLessThanOrEqual(32);
    expect((await color.boundingBox())!.height).toBeLessThanOrEqual(28);
    await page.keyboard.press("Escape");
  }
});
