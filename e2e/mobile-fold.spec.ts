import { closeDocumentSidebar } from "./helpers/workspace";
import { createDocumentInWorkspace } from "./helpers/document";
import { expect, test, type Locator } from "@playwright/test";

test("引用块折叠状态在切换文档后保持", async ({ page }) => {
  await page.goto("/");
  const createBlankNote = (title: string) => createDocumentInWorkspace(page, title);

  await createBlankNote("引用折叠文档 A");
  const editor = page.locator(".ProseMirror");
  await editor.fill("引用正文");
  await editor.press("ControlOrMeta+Shift+b");
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });

  await createBlankNote("引用折叠文档 B");
  const noteA = page.locator('.doc-tree-doc .doc-tree-name[title="引用折叠文档 A"]');
  const noteB = page.locator('.doc-tree-doc .doc-tree-name[title="引用折叠文档 B"]');
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
    const touch = {
      identifier: 77,
      target: element,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    // WebKit exposes Touch but doesn't allow constructing it. The long-press
    // helper only needs the touch lists consumed by the handlers below.
    const dispatchTouch = (type: string, touches: typeof touch[]) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: touches },
        changedTouches: { value: [touch] },
      });
      element.dispatchEvent(event);
    };
    dispatchTouch("touchstart", [touch]);
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    dispatchTouch("touchend", []);
  });
}

test.describe("手机安装版折叠操作", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

  test("真实触摸可切换标题、目录批量折叠和引用块", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await createDocumentInWorkspace(page, "触摸折叠回归");
    await page.setViewportSize({ width: 390, height: 760 });
    await closeDocumentSidebar(page);
    const editor = page.locator(".ProseMirror");
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
    const feedback = await quote.getByRole("button", { name: "展开引用块" }).evaluate((button) => {
      const hitArea = button.getBoundingClientRect();
      const icon = button.querySelector(".blockquote-fold-icon")!.getBoundingClientRect();
      return {
        hitWidth: hitArea.width,
        iconWidth: icon.width,
        iconHeight: icon.height,
        right: hitArea.right,
        quoteRight: button.closest("blockquote")!.getBoundingClientRect().right,
        outline: getComputedStyle(button).outlineStyle,
        border: getComputedStyle(button).borderTopWidth,
      };
    });
    expect(feedback.hitWidth).toBe(36);
    expect(feedback.iconWidth).toBe(22);
    expect(feedback.iconHeight).toBe(22);
    expect(feedback.right).toBeLessThanOrEqual(feedback.quoteRight);
    expect(feedback.outline).toBe("none");
    expect(feedback.border).toBe("0px");
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
    await createDocumentInWorkspace(page);
    const editor = page.locator(".ProseMirror");
    await editor.fill("只读引用正文");
    await editor.press("ControlOrMeta+Shift+b");
    await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
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
