import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

async function resizeKeyboard(page: Page, open: boolean) {
  await page.evaluate((isOpen) => {
    const viewport = window.visualViewport!;
    for (const [name, value] of Object.entries({
      height: 430,
      offsetTop: 70,
    })) {
      if (isOpen)
        Object.defineProperty(viewport, name, { configurable: true, value });
      else Reflect.deleteProperty(viewport, name);
    }
    viewport.dispatchEvent(new Event("resize"));
  }, open);
  if (open) await expect(page.locator("html")).toHaveClass(/web-keyboard-open/);
  else await expect(page.locator("html")).not.toHaveClass(/web-keyboard-open/);
}

test("键盘打开时顶部栏随外壳定位且不盖住侧栏", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await resizeKeyboard(page, true);
  const header = page.locator(".app-header");
  const app = page.locator(".app");
  expect((await header.boundingBox())!.y).toBeCloseTo(
    (await app.boundingBox())!.y,
    0,
  );
  const body = page.locator(".app-body");
  const headerRect = (await header.boundingBox())!;
  expect((await body.boundingBox())!.y).toBeCloseTo(
    headerRect.y + headerRect.height,
    0,
  );
  await page.getByTitle("搜索", { exact: true }).click();
  await expect(page.locator(".search-input")).toBeFocused();
  await page.getByTitle("显示侧栏").click();
  await expect(page.getByRole("dialog", { name: "文档侧栏" })).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, 0, 0)",
  );
  // 检查真实命中层级，而不仅是侧栏 DOM 存在。
  expect(
    await page.evaluate(
      () => !!document.elementFromPoint(20, 90)?.closest(".app-sidebar"),
    ),
  ).toBe(true);
  await page.getByTitle("隐藏侧栏").click();
  await resizeKeyboard(page, false);
  await expect(app).toHaveCSS("height", "760px");
  expect((await header.boundingBox())!.y).toBe(0);
});

test("专注模式开关键盘不为隐藏的顶部栏预留空间", async ({ page }) => {
  await page.goto("/");
  await page.locator(".note-title-row").getByTitle("专注模式").click();
  const body = page.locator(".app-body");
  const originalPadding = await body.evaluate(
    (element) => getComputedStyle(element).paddingTop,
  );
  await resizeKeyboard(page, true);
  await expect(page.locator(".app-header")).toBeHidden();
  await expect(body).toHaveCSS("padding-top", originalPadding);
  const bar = page.getByLabel("专注模式工具栏");
  await expect(bar).toBeVisible();
  expect((await bar.boundingBox())!.y).toBeCloseTo(70, 0);
  await resizeKeyboard(page, false);
  await expect(body).toHaveCSS("padding-top", originalPadding);
  expect((await bar.boundingBox())!.y).toBe(0);
});
