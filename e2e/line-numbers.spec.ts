import { test, expect } from "@playwright/test";

test.describe("编辑器块级 gutter", () => {
  test("Alt-G 可按稳定块编号跳转且不挤压正文", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill(Array.from({ length: 36 }, (_, index) => `第 ${index + 1} 块`).join("\n"));
    const editorTopBefore = await editor.evaluate((element) => element.getBoundingClientRect().top);
    await editor.press("Alt+g");

    const jumpInput = page.getByRole("dialog", { name: "跳转行号" }).getByLabel("跳转到行号");
    await expect(jumpInput).toBeVisible();
    await expect(page.locator(".editor-line-jump")).toHaveCSS("position", "absolute");
    const editorTopAfter = await editor.evaluate((element) => element.getBoundingClientRect().top);
    expect(Math.abs(editorTopAfter - editorTopBefore)).toBeLessThan(1);

    await jumpInput.fill("30");
    await jumpInput.press("Enter");
    await expect(jumpInput).toHaveCount(0);
    await expect.poll(() => editor.evaluate((element) => {
      const anchor = window.getSelection()?.anchorNode;
      const block = anchor instanceof Element ? anchor.closest(":scope > p") : anchor?.parentElement?.closest("p");
      return block?.textContent ?? "";
    })).toBe("第 30 块");
    await expect.poll(() => page.locator(".note-editor-scroll").evaluate(
      (element) => (element as HTMLElement).scrollTop,
    )).toBeGreaterThan(100);

    await editor.press("Alt+g");
    await jumpInput.fill("99");
    await jumpInput.press("Enter");
    await expect(page.getByRole("status")).toHaveText("请输入 1–36");
    await jumpInput.press("Escape");
    await expect(jumpInput).toHaveCount(0);
  });

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
    await expect(page.locator(".editor-content-shell")).toHaveCSS("--editor-gutter-width", "44px");

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

  test("分割线后的插入按钮位于分割线与下一块之间", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("第一块");
    await editor.press("End");
    await editor.press("Enter");
    await editor.type("---");
    await expect(editor.locator(":scope > hr")).toHaveCount(1);
    await editor.type("下一块");

    await page.getByTitle("设置").click();
    const lineNumberToggle = page.locator(".settings-field").filter({ hasText: "显示块编号" })
      .locator('input[type="checkbox"]');
    if (!(await lineNumberToggle.isChecked())) {
      await lineNumberToggle.evaluate((input: HTMLInputElement) => input.click());
    }
    await page.locator(".settings-close").click();
    await expect(page.locator(".editor-block-number")).toHaveText(["1", "2", "3"]);

    const dividerBox = await editor.locator(":scope > hr").boundingBox();
    const nextBlockBox = await editor.locator(":scope > p").last().boundingBox();
    const insertBox = await page.getByRole("button", { name: "在第 2 块后插入段落" }).boundingBox();
    if (!dividerBox || !nextBlockBox || !insertBox) throw new Error("gutter geometry not found");
    const insertCenter = insertBox.y + insertBox.height / 2;
    expect(insertCenter).toBeGreaterThan(dividerBox.y + dividerBox.height + 2);
    expect(insertCenter).toBeLessThan(nextBlockBox.y);
  });
});
