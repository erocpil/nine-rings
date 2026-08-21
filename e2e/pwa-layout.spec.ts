import { expect, test } from "@playwright/test";

test.describe("PWA 窄屏应用外壳", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

  test("使用顶部入口导航且移动编辑器保持简洁", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".m-toolbar")).toHaveCount(0);
    await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);

    await page.getByTitle("搜索").click();
    const searchInput = page.locator(".search-input");
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();

    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible();
    await expect(page.locator(".editor-block-insert").first()).toBeHidden();
    await expect(page.locator(".editor-status-secondary")).toBeHidden();

    const bullet = editor.locator("li").first();
    await expect(bullet).toBeVisible();
    await expect.poll(() => bullet.evaluate((element) => getComputedStyle(element).listStyleType))
      .toBe("none");
  });

  test("从文档弹层发起新建时先关闭弹层并把对话框放在最上层", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nr:sidebarHidden", "true"));
    await page.goto("/");

    await page.getByTitle("文档视图").click();
    const popup = page.locator(".doc-tree-popup-overlay");
    await expect(popup).toBeVisible();
    await popup.getByTitle("新建文档").click();

    await expect(popup).toHaveCount(0);
    const dialog = page.locator(".doc-create-dialog");
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.locator(".dialog-overlay").evaluate((element) => getComputedStyle(element).zIndex))
      .toBe("1200");
  });

  test("离线时明确提示但编辑器保持可用", async ({ page, context }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeEditable();
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.locator(".web-status-banner.offline")).toContainText("当前离线");
    await expect(page.locator(".ProseMirror")).toBeEditable();
  });

  test("软键盘高度不会重复压缩覆盖层和正文滚动区", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--app-keyboard-height", "300px");
    });

    await page.getByTitle("显示侧栏").click();
    const sidebarBottom = await page.locator(".app-sidebar").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return Math.round(rect.bottom);
    });
    const scrollPaddingBottom = await page.locator(".note-editor-scroll").evaluate(
      (element) => getComputedStyle(element).scrollPaddingBottom,
    );
    expect(sidebarBottom).toBe(760);
    expect(scrollPaddingBottom).not.toContain("300px");
  });
});

test("横屏手机保持单行工具栏且正文可滚动", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 390 });
  await page.goto("/");

  const toolbar = page.locator(".editor-menu");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveClass(/toolbar-minimal/);
  const layout = await toolbar.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    viewportHeight: document.documentElement.clientHeight,
  }));
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 1);
  expect(layout.viewportHeight).toBe(390);
  await expect(page.locator(".note-editor-scroll")).toBeVisible();
});

test("属性面板在窄屏中覆盖显示而不挤压正文", async ({ page }) => {
  await page.setViewportSize({ width: 1020, height: 640 });
  await page.goto("/");
  await page.getByTitle("显示属性面板").click();
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill("移动属性面板测试");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".properties-panel")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 760 });
  const layout = await page.locator(".properties-panel").evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return { position: style.position, right: Math.round(rect.right), width: Math.round(rect.width) };
  });
  expect(layout.position).toBe("fixed");
  expect(layout.right).toBe(390);
  expect(layout.width).toBeLessThanOrEqual(360);
});
