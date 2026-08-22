import { test, expect, type Page } from "@playwright/test";

async function createNote(page: Page) {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  return page.locator(".ProseMirror");
}

test("Tab/Shift+Tab indent consecutive text blocks with inherited depth", async ({ page }) => {
  const editor = await createNote(page);
  await editor.fill("第一块");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("第二块");

  await editor.press("Tab");
  await expect(editor.locator(":scope > p").nth(1)).toHaveAttribute("data-indent", "1");
  await expect.poll(() => editor.locator(":scope > p").nth(1).evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).marginInlineStart),
  )).toBeGreaterThan(0);
  await editor.press("Tab");
  await expect(editor.locator(":scope > p").nth(1)).toHaveAttribute("data-indent", "1");

  await editor.press("Control+A");
  await editor.press("Tab");
  await expect(editor.locator(":scope > p").nth(0)).toHaveAttribute("data-indent", "1");
  await expect(editor.locator(":scope > p").nth(1)).toHaveAttribute("data-indent", "2");

  await editor.press("Shift+Tab");
  await expect(editor.locator(":scope > p").nth(0)).not.toHaveAttribute("data-indent", /.+/);
  await expect(editor.locator(":scope > p").nth(1)).toHaveAttribute("data-indent", "1");
});

test("quote and code blocks do not add vertical outer whitespace", async ({ page }) => {
  const editor = await createNote(page);
  await editor.fill("引用内容");
  await page.getByTitle("引用 (Ctrl+Shift+B)").click();
  await expect(editor.locator(":scope > blockquote")).toHaveCSS("margin-top", "0px");
  await expect(editor.locator(":scope > blockquote")).toHaveCSS("margin-bottom", "0px");

  await page.getByTitle("引用 (Ctrl+Shift+B)").click();
  await page.getByTitle("代码块 (Ctrl+Alt+C)").click();
  await expect(editor.locator(".code-block-wrap")).toHaveCSS("margin-top", "0px");
  await expect(editor.locator(".code-block-wrap")).toHaveCSS("margin-bottom", "0px");
});

test("toolbar block indent command applies to a continuous selection", async ({ page }) => {
  const editor = await createNote(page);
  await editor.fill("甲");
  await editor.press("Enter");
  await editor.type("乙");
  await editor.press("Control+A");
  await page.getByTitle("增加块缩进 (Tab)").click();

  await expect(editor.locator(":scope > p")).toHaveCount(2);
  await expect(editor.locator(":scope > p").nth(0)).toHaveAttribute("data-indent", "1");
  await expect(editor.locator(":scope > p").nth(1)).toHaveAttribute("data-indent", "1");
});
