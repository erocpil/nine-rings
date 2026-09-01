import { expect, test, type Locator } from "@playwright/test";

async function longPress(button: Locator) {
  await button.evaluate(async (element) => {
    const rect = element.getBoundingClientRect();
    const touch = new Touch({
      identifier: 77,
      target: element,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    });
    element.dispatchEvent(new TouchEvent("touchstart", {
      bubbles: true,
      cancelable: true,
      touches: [touch],
      changedTouches: [touch],
    }));
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    element.dispatchEvent(new TouchEvent("touchend", {
      bubbles: true,
      cancelable: true,
      touches: [],
      changedTouches: [touch],
    }));
  });
}

test.describe("手机安装版折叠操作", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

  test("真实触摸可切换标题、目录批量折叠和引用块", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill("");
    await editor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "# 触摸章节\n\n章节正文\n\n> 引用正文\n\n# 末章\n\n末章正文");
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    });

    const chapterBody = editor.getByText("章节正文", { exact: true });
    const chapterBlockIndex = await editor.getByRole("heading", { name: "触摸章节" }).evaluate(
      (heading) => Array.from(heading.parentElement?.children ?? []).indexOf(heading) + 1,
    );
    await page.getByRole("button", { name: `折叠第 ${chapterBlockIndex} 块章节` }).tap();
    await expect(chapterBody).toBeHidden();
    await page.getByRole("button", { name: `展开第 ${chapterBlockIndex} 块章节` }).tap();
    await expect(chapterBody).toBeVisible();

    const quote = editor.locator("blockquote");
    await quote.getByRole("button", { name: "折叠引用块" }).tap();
    await expect(quote).toHaveAttribute("data-collapsed", "true");
    await quote.getByRole("button", { name: "展开引用块" }).tap();
    await expect(quote).toHaveAttribute("data-collapsed", "false");

    await page.getByTitle("文档目录").tap();
    const outline = page.getByRole("navigation", { name: "文档目录" });
    const collapseAll = outline.getByRole("button", { name: "全部折叠" });
    await collapseAll.tap();
    await collapseAll.tap();
    await expect(chapterBody).toBeHidden();

    const expandAll = outline.getByRole("button", { name: "全部展开" });
    await expandAll.tap();
    await expandAll.tap();
    await expect(chapterBody).toBeVisible();

    await longPress(collapseAll);
    await expect(chapterBody).toBeHidden();
    await longPress(expandAll);
    await expect(chapterBody).toBeVisible();
  });

  test("标题重新展开后引用折叠按钮按新布局重绘", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill("");
    await editor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "# 示例答案\n\n> 引用正文第一行\n> 引用正文第二行\n\n# 下一节\n\n末尾正文");
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    });

    const heading = editor.getByRole("heading", { name: "示例答案" });
    const headingBlockIndex = await heading.evaluate(
      (element) => Array.from(element.parentElement?.children ?? []).indexOf(element) + 1,
    );
    const quoteToggle = editor.getByRole("button", { name: "折叠引用块" });
    await expect(quoteToggle).toBeVisible();

    await page.getByRole("button", { name: `折叠第 ${headingBlockIndex} 块章节` }).tap();
    await expect(quoteToggle).toBeHidden();
    await page.getByRole("button", { name: `展开第 ${headingBlockIndex} 块章节` }).tap();

    // 不触发滚动；控件必须经历一次隐藏绘制，再以恢复后的坐标出现。
    await expect(editor).not.toHaveClass(/heading-fold-repainting/);
    await expect(quoteToggle).toBeVisible();
    const alignment = await quoteToggle.evaluate((button) => {
      const toolbar = button.closest(".blockquote-toolbar");
      if (!(toolbar instanceof HTMLElement)) throw new Error("blockquote toolbar missing");
      const buttonRect = button.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      return Math.abs(
        (buttonRect.top + buttonRect.height / 2)
        - (toolbarRect.top + toolbarRect.height / 2),
      );
    });
    expect(alignment).toBeLessThan(1);
  });

  test("只读文档仍可展开和折叠引用块", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByTitle("随笔").click();
    const editor = page.locator(".ProseMirror");
    await editor.fill("只读引用正文");
    await editor.press("Control+Shift+b");
    await page.locator(".sidebar-item.active").getByTitle("设为只读").click({ force: true });
    await page.setViewportSize({ width: 390, height: 760 });
    await page.locator(".sidebar-overlay.active").evaluate((element) => (element as HTMLElement).click());
    await expect(page.locator(".sidebar-overlay.active")).toHaveCount(0);

    const quote = editor.locator("blockquote");
    const fold = quote.getByRole("button", { name: "折叠引用块" });
    await expect(fold).toBeEnabled();
    await fold.tap();
    await expect(quote).toHaveAttribute("data-collapsed", "true");
    await quote.getByRole("button", { name: "展开引用块" }).tap();
    await expect(quote).toHaveAttribute("data-collapsed", "false");
  });
});
