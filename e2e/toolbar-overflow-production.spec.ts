import { expect, test, type Page } from "@playwright/test";

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
});

async function expectToolbarFits(page: Page) {
  const toolbar = page.locator(".editor-menu");
  await expect(toolbar).toBeVisible();
  await expect(page.getByTitle("更多编辑操作", { exact: true })).toHaveCount(0);
  const image = toolbar.getByRole("button", { name: "插入图片", exact: true });
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await expect.poll(() => toolbar.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);

}

for (const width of [320, 390, 430])
  test(`正式版手机首屏工具栏可滚动且图片按钮可用 ${width}`, async ({
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
        path: test.info().outputPath(`nr-mobile-toolbar-${browserName}.png`),
      });
  });

test("只读文档重启后切回编辑并旋转屏幕，工具按钮始终可用", async ({ page }) => {
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
    await expect(toolbar).toHaveClass(/toolbar-scrollable/);
    await page.setViewportSize({ width: 780, height: 900 });
    await expect(toolbar).toHaveClass(/toolbar-scrollable/);
    await expectToolbarFits(page);
  });
});
