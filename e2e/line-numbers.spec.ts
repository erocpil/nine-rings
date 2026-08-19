import { test, expect } from "@playwright/test";

test.describe("编辑器块级 gutter", () => {
  test("只读文档仍显示块编号，但不显示插入按钮", async ({ page }) => {
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
    const lineNumberField = page.locator(".settings-field").filter({ hasText: "显示块编号" });
    const lineNumberToggle = lineNumberField.locator('input[type="checkbox"]');
    await lineNumberToggle.evaluate((input: HTMLInputElement) => input.click());
    await expect(lineNumberToggle).toBeChecked();
    await page.locator(".settings-close").click();
    await expect(page.locator(".note-editor")).toHaveClass(/show-line-numbers/);

    const readonlyButton = page.locator(".sidebar-item.active").getByTitle("设为只读");
    await readonlyButton.evaluate((button: HTMLButtonElement) => button.click());
    await expect(editor).toHaveAttribute("contenteditable", "false");

    await expect(page.locator(".editor-block-number")).toHaveText(["1", "2"]);
    await expect(page.locator(".editor-block-insert")).toHaveCount(0);
  });

  test("只有明确的加号按钮会插入段落", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("第一块\n第二块");
    await expect(editor.locator(":scope > p")).toHaveCount(2);

    await page.getByTitle("设置").click();
    const lineNumberToggle = page.locator(".settings-field").filter({ hasText: "显示块编号" })
      .locator('input[type="checkbox"]');
    if (!(await lineNumberToggle.isChecked())) {
      await lineNumberToggle.evaluate((input: HTMLInputElement) => input.click());
    }
    await page.locator(".settings-close").click();
    await expect(page.locator(".editor-block-number")).toHaveText(["1", "2"]);
    await expect(page.locator(".editor-block-insert")).toHaveCount(3);

    // 编号仅用于显示，强制触发点击也不能产生编辑事务。
    await page.locator(".editor-block-number").first().dispatchEvent("click");
    await expect(editor.locator(":scope > p")).toHaveCount(2);

    await page.getByRole("button", { name: "在第 1 块后插入段落" }).click();
    await page.keyboard.type("插入块");
    await expect(editor.locator(":scope > p")).toHaveCount(3);
    await expect(editor.locator(":scope > p").nth(1)).toHaveText("插入块");
  });
});
