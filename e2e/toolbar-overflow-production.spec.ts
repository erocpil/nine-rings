import { expect, test, type Page } from "@playwright/test";

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
});

async function expectToolbarFits(page: Page) {
  const toolbar = page.locator(".editor-menu");
  const more = page.getByRole("button", { name: "更多编辑操作", exact: true });
  await expect(toolbar).toBeVisible();
  await expect(more).toBeVisible();
  await expect
    .poll(() => toolbar.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(2);
  await expect
    .poll(() =>
      more.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return (
          box.left >= 0 &&
          box.right <= document.documentElement.clientWidth &&
          el.contains(hit)
        );
      }),
    )
    .toBe(true);
  await more.tap();
  const sheet = page.getByRole("dialog", { name: "更多编辑操作", exact: true });
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: "插入图片", exact: true }),
  ).toBeVisible();
  await sheet
    .getByRole("button", { name: "关闭更多编辑操作", exact: true })
    .tap();
  await expect(sheet).toHaveCount(0);
}

for (const width of [320, 390, 430])
  test(`正式版手机首屏工具栏完整并可打开更多 ${width}`, async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toHaveAttribute(
      "contenteditable",
      "true",
      { timeout: 20000 },
    );
    await expectToolbarFits(page);
    if (width === 390)
      await page.screenshot({
        path: `/tmp/nr-mobile-toolbar-${browserName}.png`,
      });
  });

test("只读文档重启后切回编辑并旋转屏幕，更多始终可用", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toHaveAttribute(
    "contenteditable",
    "true",
    { timeout: 20000 },
  );
  await page.getByRole("button", { name: "点击设为只读", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "点击设为可编辑", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "点击设为可编辑", exact: true }).tap();
  await expect(page.locator(".ProseMirror")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await expectToolbarFits(page);
  for (const viewport of [
    { width: 844, height: 390 },
    { width: 320, height: 844 },
    { width: 430, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expectToolbarFits(page);
  }
});

test.describe("桌面工具栏重新挂载", () => {
  test.use({
    hasTouch: false,
    isMobile: false,
    viewport: { width: 1440, height: 900 },
  });
  test("只读切回编辑后仍按文本区宽度切换精简工具栏", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toHaveAttribute(
      "contenteditable",
      "true",
      { timeout: 20000 },
    );
    await page
      .getByRole("button", { name: "点击设为只读", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "点击设为可编辑", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: "点击设为可编辑", exact: true })
      .click();
    const toolbar = page.locator(".editor-menu");
    await expect(toolbar).toHaveClass(/toolbar-full/);
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(toolbar).toHaveClass(/toolbar-minimal/);
    await expect
      .poll(() => toolbar.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBeLessThanOrEqual(2);
    await page
      .getByRole("button", { name: "更多编辑操作", exact: true })
      .click();
    await expect(page.locator(".toolbar-more-list")).toBeVisible();
  });
});
