import { expect, test } from "@playwright/test";
import { openDocumentSidebar } from "./helpers/workspace";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

test("横屏工具栏可触摸，旋转后滞留高度不会把文档树截成半屏", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--safe-left", "44px");
    document.documentElement.style.setProperty("--safe-right", "44px");
  });
  const bar = page.locator(".note-title-row");
  await expect(bar).toBeVisible();
  const barBottom = (await bar.boundingBox())!;
  expect(barBottom.height).toBeGreaterThanOrEqual(38);
  await expect(page.locator(".app")).toHaveCSS("height", "390px");
  for (const name of ["文档目录", "文档书签"]) {
    const button = bar.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(32);
    expect(box.width).toBeGreaterThanOrEqual(32);
    expect(box.width).toBeLessThanOrEqual(44);
    expect(box.y + box.height).toBeLessThanOrEqual(barBottom.y + barBottom.height + 1);
    expect(box.x).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(800);
    // Tap the unified title-row control at its center.
    await button.tap({ position: { x: 16, y: 18 } });
    await expect(page.getByRole("navigation", { name, exact: true })).toBeVisible();
    await button.tap({ position: { x: 16, y: 18 } });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.removeProperty("--safe-left");
    document.documentElement.style.removeProperty("--safe-right");
    // iOS can update width first and leave only height/offset stale.
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 390 });
    Object.defineProperty(window.visualViewport!, "offsetTop", { configurable: true, value: 90 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("html")).not.toHaveClass(/web-keyboard-open/);
  await openDocumentSidebar(page);
  await expect(page.getByRole("dialog", { name: "文档侧栏", exact: true })).toBeVisible();
  for (const selector of [".app-sidebar", ".sidebar-overlay"]) {
    await expect.poll(() => page.locator(selector).evaluate(el =>
      Math.abs(el.getBoundingClientRect().height - 844),
    )).toBeLessThan(1);
  }
  expect(await page.evaluate(() => document.elementFromPoint(380, 800)?.classList.contains("sidebar-overlay"))).toBe(true);
});
