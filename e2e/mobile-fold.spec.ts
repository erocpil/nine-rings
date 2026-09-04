import { expect, test, type Locator } from "@playwright/test";

test("引用块折叠状态在切换文档后保持", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();

  const createBlankNote = async (title: string) => {
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
    const titleInput = page.getByRole("textbox", { name: "随心记 — 标题" });
    await expect(titleInput).toHaveValue("新随笔");
    await expect(page.locator(".sidebar-item.active .sidebar-item-title")).toHaveText("新随笔");
    await titleInput.fill(title);
    await expect(titleInput).toHaveValue(title);
    await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".sidebar-item.active .sidebar-item-title")).toHaveText(title);
  };

  await createBlankNote("引用折叠文档 A");
  const editor = page.locator(".ProseMirror");
  await editor.fill("引用正文");
  await editor.press("Control+Shift+b");
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });

  await createBlankNote("引用折叠文档 B");
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });
  const noteA = page.locator('.sidebar-item-title[title="引用折叠文档 A"]');
  const noteB = page.locator('.sidebar-item-title[title="引用折叠文档 B"]');
  await noteA.click();

  const quote = editor.locator("blockquote");
  await quote.getByRole("button", { name: "折叠引用块" }).click();
  await expect(quote).toHaveAttribute("data-collapsed", "true");

  // 不等待 600ms 自动保存；A → B → A 必须直接使用会话中的最新文档。
  await noteB.click();
  await noteA.click();
  await expect(editor.locator("blockquote")).toHaveAttribute("data-collapsed", "true");
  await expect(editor.getByRole("button", { name: "展开引用块" })).toBeVisible();
});

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

  test("只读文档仍可展开和折叠引用块", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByTitle("随笔").click();
    const editor = page.locator(".ProseMirror");
    await editor.fill("只读引用正文");
    await editor.press("Control+Shift+b");
    const activeNote = page.locator(".sidebar-item.active");
    await activeNote.getByRole("button", { name: /更多随笔操作/ }).click();
    await page.getByRole("dialog", { name: /随笔：/ })
      .getByRole("button", { name: "🔒 设为只读" })
      .click();
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
