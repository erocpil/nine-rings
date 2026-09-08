import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("专注模式正文延伸到底部，不保留固定安全区空白", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  // Desktop browser runners do not expose the iPhone Home Indicator inset.
  await page.evaluate(() => document.documentElement.style.setProperty("--safe-bottom", "34px"));
  await expect(page.locator(".app-main")).toHaveCSS("padding-bottom", "34px");
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".app-main")).toHaveCSS("padding-bottom", "0px");
    await expect(page.locator(".editor-stats")).toBeHidden();
    await expect.poll(() => page.locator(".note-editor-scroll").evaluate(el =>
      Math.abs(el.getBoundingClientRect().bottom - document.querySelector(".app")!.getBoundingClientRect().bottom),
    )).toBeLessThanOrEqual(1);
    await expect(page.locator(".note-editor-scroll")).toHaveCSS("scroll-padding-bottom", "46px");
  }
  await page.getByRole("button", { name: "退出专注模式", exact: true }).click();
  await expect(page.locator(".app-main")).toHaveCSS("padding-bottom", "34px");
});
