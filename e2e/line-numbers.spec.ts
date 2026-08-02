import { test, expect } from "@playwright/test";

test.describe("编辑器行号", () => {
  test("只读文档仍显示第一行行号", async ({ page }) => {
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("第一行");
    await editor.press("End");
    await editor.press("Enter");
    await editor.type("第二行");
    await expect(editor.locator(":scope > p")).toHaveCount(2);

    await page.getByTitle("设置").click();
    const lineNumberField = page.locator(".settings-field").filter({ hasText: "显示行号" });
    const lineNumberToggle = lineNumberField.locator('input[type="checkbox"]');
    await lineNumberToggle.evaluate((input: HTMLInputElement) => input.click());
    await expect(lineNumberToggle).toBeChecked();
    await page.locator(".settings-close").click();
    await expect(page.locator(".note-editor")).toHaveClass(/show-line-numbers/);

    const readonlyButton = page.locator(".sidebar-item.active").getByTitle("设为只读");
    await readonlyButton.evaluate((button: HTMLButtonElement) => button.click());
    await expect(editor).toHaveAttribute("contenteditable", "false");

    const lineNumbers = await editor.locator(":scope > p").evaluateAll((paragraphs) =>
      paragraphs.map((paragraph) => {
        const style = getComputedStyle(paragraph, "::before");
        return { content: style.content, display: style.display };
      }),
    );
    expect(lineNumbers).toEqual([
      { content: "counter(prose-line)", display: "block" },
      { content: "counter(prose-line)", display: "block" },
    ]);
  });
});
