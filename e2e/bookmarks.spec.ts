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
