import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("滚动工具栏可直接导出正文 PDF", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.getByTitle("更多编辑操作", { exact: true })).toHaveCount(0);
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "导出 PDF", exact: true }).tap();
  const popup = await popupPromise;
  await expect(popup.locator(".document-content")).toContainText("欢迎使用 Nine Rings");
});

test("横向滚动后字号菜单仍在视口内并可操作", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  for (const width of [320, 390, 844]) {
    await page.setViewportSize({ width, height: 844 });
    const toolbar = page.locator(".editor-menu");
    await expect(toolbar.locator('[data-toolbar-overflow="true"]')).toHaveCount(0);
    const size = page.getByTitle("字号", { exact: true });
    await size.tap();
    const menu = toolbar.locator(".menu-dropdown-list:visible");
    await expect(menu).toBeVisible();
    const rect = (await menu.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    await menu.getByRole("button", { name: "20px", exact: true }).tap();
    await expect(size).toContainText("20");
    await expect(menu).toHaveCount(0);
  }
});

test("工具按钮上横向滑动滚动工具栏而不执行命令，新点击仍可用", async ({ page }) => {
  await page.goto("/");
  const toolbar = page.locator(".editor-menu");
  const undo = toolbar.getByTitle("复制块", { exact: true });
  await undo.scrollIntoViewIfNeeded();
  const result = await undo.evaluate(button => {
    const toolbar = button.closest(".editor-menu")!;
    let clicks = 0;
    button.addEventListener("click", () => { clicks++; });
    const before = toolbar.scrollLeft;
    for (const [type, x] of [["touchstart", 230], ["touchmove", 130], ["touchend", 130]] as const) {
      const touch = { identifier: 5, target: button, clientX: x, clientY: 200 };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: type === "touchend" ? [] : [touch] }, changedTouches: { value: [touch] } });
      button.dispatchEvent(event);
    }
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return { delta: toolbar.scrollLeft - before, clicks };
  });
  expect(result.delta).toBeGreaterThan(50);
  expect(result.clicks).toBe(0);
  await page.getByTitle("字号", { exact: true }).tap();
  await expect(toolbar.locator(".menu-dropdown-list")).toBeVisible();
});
