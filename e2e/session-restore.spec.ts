import { expect, test, type Page } from "@playwright/test";

async function createDocument(page: Page, title: string) {
  await page.goto("/");
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill(title);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
}

test.describe("会话位置恢复与编辑器查找", () => {
  test("重载后恢复最后打开的文档、光标和滚动位置", async ({ page }) => {
    const title = "会话恢复测试文档";
    await createDocument(page, title);

    const editor = page.locator(".ProseMirror");
    const paragraphs = Array.from(
      { length: 80 },
      (_, index) => `第 ${index + 1} 段：${"用于验证重启后位置恢复的正文。".repeat(4)}`,
    );
    await editor.fill(paragraphs.join("\n"));
    await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });

    const anchor = editor.locator(":scope > p").nth(56);
    await anchor.scrollIntoViewIfNeeded();
    await anchor.click();

    const noteId = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
    expect(noteId).toBeTruthy();
    const before = await page.locator(".note-editor-scroll").evaluate((element) => {
      const scroller = element as HTMLElement;
      scroller.scrollTop = Math.max(200, scroller.scrollHeight * 0.65);
      scroller.dispatchEvent(new Event("scroll"));
      return scroller.scrollTop;
    });
    expect(before).toBeGreaterThan(100);

    await expect.poll(() => page.evaluate(
      (id) => Number(localStorage.getItem(`scrollPos:${id}`)),
      noteId,
    )).toBeGreaterThan(100);
    await expect.poll(() => page.evaluate(
      (id) => localStorage.getItem(`selectionPos:${id}`),
      noteId,
    )).not.toBeNull();

    await page.reload();
    await expect(page.locator(".note-title")).toHaveValue(title);
    await expect.poll(() => page.locator(".note-editor-scroll").evaluate(
      (element) => (element as HTMLElement).scrollTop,
    )).toBeGreaterThan(100);
    await editor.focus();
    await expect.poll(() => page.locator(".ProseMirror").evaluate((element) => {
      const selection = window.getSelection();
      return Boolean(selection?.anchorNode && element.contains(selection.anchorNode));
    })).toBe(true);
  });

  test("Ctrl-F 查找框在主窗口关闭时同步关闭", async ({ page }) => {
    await createDocument(page, "窗口内查找测试");
    const editor = page.locator(".ProseMirror");
    await editor.fill("第一处 current-find-target\n中间正文\n第二处 current-find-target");
    await editor.click();
    await page.keyboard.press("Control+f");

    const findInput = page.getByRole("search").getByLabel("在当前文档中查找");
    await expect(findInput).toBeVisible();
    await findInput.fill("current-find-target");
    await expect(page.locator(".editor-find-count")).toHaveText("1/2");
    await findInput.press("Enter");
    await expect(page.locator(".editor-find-count")).toHaveText("2/2");

    // Web E2E 没有 Tauri 标题栏；直接验证标题栏在 hide 前广播的同一事件。
    await page.evaluate(() => window.dispatchEvent(new Event("nine-rings:main-window-hide")));
    await expect(findInput).toHaveCount(0);
    await expect(page.locator(".search-match")).toHaveCount(0);
  });
});
