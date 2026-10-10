import { pressLineBoundary } from "./helpers/keyboard";
import { expect, test } from "@playwright/test";

test("常用代码语言增量高亮并同步到 PDF 打印视图", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill("代码高亮 PDF");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByTitle("显示属性面板").click();

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
  await pressLineBoundary(editor, "end");
  await editor.press("Enter");
  await editor.type('console.log("done");');
  await expect(block.locator(".hljs-string")).toContainText('"done"');

  await language.focus();
  await language.selectOption("");
  await expect(block.locator('[class*="hljs-"]')).toHaveCount(0);
  await language.selectOption("typescript");
  await expect(block.locator(".hljs-keyword")).toContainText("const");

  await page.locator(".properties-panel .prop-readonly-toggle").click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(language).toBeVisible();
  await expect(language).toBeDisabled();

  const popupPromise = page.waitForEvent("popup");
  await page.locator(".properties-panel").getByRole("button", { name: "导出 PDF（书签大纲）" }).click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");
  await expect(printPage.locator(".document-content .hljs-keyword")).toContainText("const");
  await expect(printPage.locator(".code-block-language, .code-block-copy, [data-pdf-exclude]")).toHaveCount(0);
  await printPage.close();

  // Native export uses a dedicated print WebView, with the same prepared HTML.
  await page.evaluate(() => {
    const host = window as typeof window & { __TAURI_INTERNALS__?: unknown; nativePrintHtml?: string };
    host.__TAURI_INTERNALS__ = { invoke: async (command: string, args: { html?: string }) => {
      if (command === "open_pdf_print_preview") host.nativePrintHtml = args.html;
    } };
    window.open = () => { throw new Error("native export must not use window.open"); };
  });
  await page.locator(".properties-panel").getByRole("button", { name: "导出 PDF（书签大纲）" }).click();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { nativePrintHtml?: string }
  ).nativePrintHtml ?? "")).toContain("hljs-keyword");
  const html = await page.evaluate(() => (
    window as typeof window & { nativePrintHtml?: string }
  ).nativePrintHtml!);
  expect(html).toContain("hljs-string");
  expect(html).not.toContain("code-block-copy");
});
