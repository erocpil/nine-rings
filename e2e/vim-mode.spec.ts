import { expect, test } from "@playwright/test";

test("实验性 Vim 模式可切换 Normal/Insert 并执行基础命令", async ({ page }) => {
  await page.goto("/");

  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await editor.fill("alpha beta");

  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^编辑器/ }).click();
  const vimField = page.locator(".settings-field").filter({ hasText: "Vim 模式（实验性）" });
  await vimField.locator(".settings-toggle").click();
  await expect(vimField.locator('input[type="checkbox"]')).toBeChecked();
  await page.locator(".settings-close").click();

  const mode = page.locator(".editor-vim-status");
  await expect(mode).toHaveText("NORMAL");

  await editor.click();
  await page.keyboard.press("i");
  await expect(mode).toHaveText("INSERT");
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(editor).toContainText("alpha beta!");

  await page.keyboard.press("Escape");
  await expect(mode).toHaveText("NORMAL");
  await page.keyboard.press("Control+f");
  await expect(page.locator(".editor-find-bar")).toHaveCount(0);

  await page.keyboard.press("0");
  await page.keyboard.press("x");
  await expect(editor).toContainText("lpha beta!");

  await page.keyboard.press("d");
  await page.keyboard.press("d");
  await expect(editor).not.toContainText("lpha beta!");

  await page.keyboard.press("u");
  await expect(editor).toContainText("lpha beta!");
});
