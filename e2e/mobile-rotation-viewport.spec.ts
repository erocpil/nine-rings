import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

test("横屏工具栏可触摸，旋转后滞留高度不会把文档树截成半屏", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--safe-left", "44px");
    document.documentElement.style.setProperty("--safe-right", "44px");
  });
  const bar = page.getByLabel("专注模式工具栏");
  await expect(bar).toHaveCSS("height", "30px");
  await expect(bar).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
  await expect(bar).toHaveCSS("box-shadow", "none");
  await expect(page.locator(".note-editor-scroll")).toHaveCSS("padding-top", "30px");
  const barBottom = (await bar.boundingBox())!;
  for (const name of ["文档目录", "文档书签"]) {
    const button = bar.getByRole("button", { name, exact: true });
    await expect(button).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBe(32);
    expect(box.y + box.height).toBeGreaterThan(barBottom.y + barBottom.height);
    expect(box.x).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(800);
    // Tap near the lower edge rather than the small glyph at its center.
    await button.tap({ position: { x: 22, y: 40 } });
    await expect(page.getByRole("navigation", { name, exact: true })).toBeVisible();
    await button.tap({ position: { x: 22, y: 40 } });
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
  // Focus mode hides the global header: use its normal left-edge swipe.
  await page.locator(".note-editor").evaluate(el => {
    for (const [type, x] of [["touchstart", 8], ["touchmove", 120], ["touchend", 120]] as const) {
      const touch = { identifier: 1, target: el, clientX: x, clientY: 650 };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: type === "touchend" ? [] : [touch] },
        changedTouches: { value: [touch] },
      });
      el.dispatchEvent(event);
    }
  });
  await expect(page.getByRole("dialog", { name: "文档侧栏", exact: true })).toBeVisible();
  for (const selector of [".app-sidebar", ".sidebar-overlay"]) {
    await expect.poll(() => page.locator(selector).evaluate(el =>
      Math.abs(el.getBoundingClientRect().height - 844),
    )).toBeLessThan(1);
  }
  expect(await page.evaluate(() => document.elementFromPoint(380, 800)?.classList.contains("sidebar-overlay"))).toBe(true);
});
