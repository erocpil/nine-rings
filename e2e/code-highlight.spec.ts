import { expect, test } from "@playwright/test";

test("常用代码语言增量高亮并同步到 PDF 打印视图", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const markdown = "```ts\nconst answer: number = 42;\n```";
  const editor = page.locator(".ProseMirror");
  await editor.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  }, markdown);

  const block = editor.locator(".code-block-wrap");
  const language = block.getByLabel("代码语言");
  await expect(language).toHaveValue("typescript");
  await expect(block.locator(".hljs-keyword")).toContainText("const");
  await expect(block.locator(".hljs-number")).toContainText("42");

  await block.locator("code").click();
  await editor.press("End");
  await editor.press("Enter");
  await editor.type('console.log("done");');
  await expect(block.locator(".hljs-string")).toContainText('"done"');

  await language.selectOption("");
  await expect(block.locator('[class*="hljs-"]')).toHaveCount(0);
  await language.selectOption("typescript");
  await expect(block.locator(".hljs-keyword")).toContainText("const");

  const popupPromise = page.waitForEvent("popup");
  await page.getByTitle("导出 PDF（含目录）").click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");
  await expect(printPage.locator(".document-content .hljs-keyword")).toContainText("const");
  await expect(printPage.locator(".code-block-language, .code-block-copy, [data-pdf-exclude]")).toHaveCount(0);

  await page.locator(".sidebar-item.active").getByTitle("设为只读")
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(language).toBeDisabled();
});
