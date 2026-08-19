import { expect, test } from "@playwright/test";

async function createBlankNote(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.locator(".note-editor-scroll").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test.describe("响应式编辑器工具栏", () => {
  test("默认桌面窗口和表格上下文均不产生水平滚动", async ({ page }) => {
    await page.setViewportSize({ width: 1020, height: 640 });
    await createBlankNote(page);

    const toolbar = page.locator(".editor-menu");
    await expect(toolbar).toHaveClass(/toolbar-compact/);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "块 ▾" }).click();
    await page.getByRole("button", { name: "▦ 插入表格" }).click();
    const table = page.locator(".ProseMirror table");
    await expect(table).toHaveCount(1);
    await table.locator("td").first().click();
    await expect(page.getByTitle("表格操作")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 1200, height: 700 });
    await expect(toolbar).toHaveClass(/toolbar-full/);
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 800, height: 540 });
    await expect(toolbar).toHaveClass(/toolbar-minimal/);
    await expect(page.getByTitle("更多编辑操作")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
