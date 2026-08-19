import { test, expect, type Page } from "@playwright/test";

async function createDocument(page: Page, title: string) {
  await page.goto("/");
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill(title);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
}

test.describe("搜索定位与编辑器布局锚点", () => {
  test("点击搜索结果定位正文命中，并可在多处命中间导航", async ({ page }) => {
    await createDocument(page, "搜索定位测试");
    const editor = page.locator(".ProseMirror");
    await editor.fill("第一处 unique-search-target 在这里");
    await editor.press("End");
    await editor.press("Enter");
    await editor.type("中间内容");
    await editor.press("Enter");
    await editor.type("第二处 unique-search-target 在这里");

    // 等待自动保存把正文同步到全文搜索字段。
    await page.waitForTimeout(800);
    await page.locator(".search-input").fill("unique-search-target");
    const result = page.locator(".search-hit").filter({ hasText: "搜索定位测试" });
    await expect(result).toBeVisible();
    await result.click();

    await expect(page.locator(".search-match")).toHaveCount(2);
    await expect(page.locator(".editor-search-navigation")).toContainText("1 / 2");
    await page.getByRole("button", { name: "下一处匹配" }).click();
    await expect(page.locator(".editor-search-navigation")).toContainText("2 / 2");
    await expect(page.locator(".search-match-active")).toHaveCount(1);
  });

  test("关闭结果保留关键词，再次聚焦时保存编辑并刷新结果", async ({ page }) => {
    await createDocument(page, "搜索刷新测试");
    const editor = page.locator(".ProseMirror");
    const input = page.locator(".search-input");
    const header = page.locator(".search-results-header");
    const keyword = "fresh-search-target";

    await editor.fill(`正文包含 ${keyword}`);
    await page.waitForTimeout(800);
    await input.fill(keyword);
    await expect(header).toContainText("搜索结果（1）");

    // Esc 只关闭结果，不删除查询；输入框被主动 blur，下一次点击会触发新搜索。
    await input.press("Escape");
    await expect(page.locator(".search-results")).toHaveCount(0);
    await expect(input).toHaveValue(keyword);
    await input.click();
    await expect(header).toContainText("搜索结果（1）");

    // 显式关闭按钮同样保留关键词。修改后不等待 600ms 自动保存，
    // 再次聚焦必须先 flush，因而旧关键词不应继续命中。
    await page.getByRole("button", { name: "关闭搜索结果" }).click();
    await expect(input).toHaveValue(keyword);
    await editor.fill("正文已经改变，不再包含原来的检索词");
    await input.click();
    await expect(header).toContainText("搜索结果（0）");
  });

  test("侧栏和窗口宽度变化后保持光标内容的屏幕位置", async ({ page }) => {
    await createDocument(page, "布局锚点测试");
    const editor = page.locator(".ProseMirror");
    const paragraphs = Array.from({ length: 24 }, (_, index) =>
      `第 ${index + 1} 段 ${"用于测试软换行的较长文本 ".repeat(7)}`,
    );
    await editor.fill(paragraphs.join("\n"));

    const anchorParagraph = editor.locator(":scope > p").nth(17);
    await anchorParagraph.scrollIntoViewIfNeeded();
    await anchorParagraph.click();

    const selectionTop = () => page.evaluate(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return null;
      return selection.getRangeAt(0).getBoundingClientRect().top;
    });

    const beforeSidebar = await selectionTop();
    expect(beforeSidebar).not.toBeNull();
    await page.getByTitle("隐藏侧栏").click();
    await page.waitForTimeout(100);
    const afterSidebar = await selectionTop();
    expect(Math.abs((afterSidebar ?? 0) - (beforeSidebar ?? 0))).toBeLessThanOrEqual(4);

    const beforeWindow = await selectionTop();
    await page.setViewportSize({ width: 1540, height: 800 });
    await page.waitForTimeout(100);
    const afterWindow = await selectionTop();
    expect(Math.abs((afterWindow ?? 0) - (beforeWindow ?? 0))).toBeLessThanOrEqual(4);
  });
});
