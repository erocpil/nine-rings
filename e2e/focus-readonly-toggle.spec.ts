import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("专注标题前的线框锁切换只读，横竖屏不退出专注", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await page.locator(".note-title-row").getByTitle("专注模式", { exact: true }).click();
  const bar = page.getByLabel("专注模式工具栏");
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const lock = bar.getByRole("button", { name: "点击设为只读", exact: true });
    await expect(lock.locator("svg.toolbar-icon")).toBeVisible();
    expect(await lock.evaluate(el => el.nextElementSibling?.classList.contains("mobile-focus-title-wrap"))).toBe(true);
    await lock.tap();
    await expect(editor).toHaveAttribute("contenteditable", "false");
    const unlock = bar.getByRole("button", { name: "点击设为可编辑", exact: true });
    await expect(unlock).toHaveAttribute("aria-pressed", "true");
    await unlock.tap();
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await expect(page.locator(".app")).toHaveClass(/app-focus-mode/);
  }
});
