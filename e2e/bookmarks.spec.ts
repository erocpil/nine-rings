import { expect, test } from "@playwright/test";

async function createBlankNote(page: import("@playwright/test").Page) {
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
}

async function enableVimMode(page: import("@playwright/test").Page) {
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^编辑器/ }).click();
  const field = page.locator(".settings-field").filter({ hasText: "Vim 模式（实验性）" });
  if (!(await field.locator('input[type="checkbox"]').isChecked())) await field.locator(".settings-toggle").click();
  await page.locator(".settings-close").click();
}

test("正文书签可切换、跳转并随文档保存", async ({ page }) => {
  await page.goto("/");
  await createBlankNote(page);
  const editor = page.locator(".ProseMirror");
  await editor.fill("第一段");
  await editor.press("End");
  await editor.press("Enter");
  await page.keyboard.type("第二段书签位置");
  await page.keyboard.press("Control+Shift+m");

  const bookmarkButton = page.getByRole("button", { name: "文档书签" });
  await expect(bookmarkButton).toContainText("1");
  await bookmarkButton.click();
  const panel = page.getByRole("navigation", { name: "文档书签" });
  await expect(panel).toContainText("第二段书签位置");
  await expect(editor.locator(".editor-bookmarked-block")).toHaveCount(1);

  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "文档书签" })).toContainText("1");
});

test("设置中的书签列表包含文档书签", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill("书签集中管理测试");
  await page.getByRole("button", { name: "创建", exact: true }).click();

  const editor = page.locator(".ProseMirror");
  await editor.fill("设置页应显示的文档书签");
  await page.keyboard.press("Control+Shift+m");
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });

  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^书签/ }).click();
  const bookmarkManager = page.locator(".bookmark-manager-list");
  await expect(bookmarkManager).toContainText("书签集中管理测试");
  await expect(bookmarkManager).toContainText("设置页应显示的文档书签");
});

test("Vim m{a-z} 设置命名书签，'{a-z} 跳转", async ({ page }) => {
  await page.goto("/");
  await createBlankNote(page);
  const editor = page.locator(".ProseMirror");
  await editor.fill("第一段");
  await editor.press("End");
  await editor.press("Enter");
  await page.keyboard.type("第二段");
  await enableVimMode(page);
  await editor.getByText("第二段", { exact: true }).click();
  await page.keyboard.press("m");
  await page.keyboard.press("a");
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await page.keyboard.press("'");
  await page.keyboard.press("a");

  await expect.poll(() => page.evaluate(() => {
    const anchor = window.getSelection()?.anchorNode;
    return (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest("p")?.textContent ?? "";
  })).toBe("第二段");
});

test.describe("移动端书签操作", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

  test("重命名和删除按钮保持足够的触控尺寸与间距", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill("移动端书签操作测试");
    await page.keyboard.press("Control+Shift+m");

    const bookmarkButton = page.locator(".document-bookmark-toggle");
    await expect(bookmarkButton).toContainText("1");
    await bookmarkButton.click();

    const actions = page.locator(".document-bookmark-action");
    await expect(actions).toHaveCount(2);
    const geometry = await actions.evaluateAll((buttons) => {
      const [rename, remove] = buttons.map((button) => button.getBoundingClientRect());
      return {
        widths: [rename.width, remove.width],
        heights: [rename.height, remove.height],
        gap: remove.left - rename.right,
      };
    });
    expect(Math.min(...geometry.widths)).toBeGreaterThanOrEqual(44);
    expect(Math.min(...geometry.heights)).toBeGreaterThanOrEqual(44);
    expect(geometry.gap).toBeGreaterThanOrEqual(8);
  });
});
