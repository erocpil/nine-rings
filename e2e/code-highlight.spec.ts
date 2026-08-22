import { expect, test } from "@playwright/test";

test("常用代码语言增量高亮并同步到 PDF 打印视图", async ({ page }) => {
  await page.goto("/");
  const viewSwitch = page.locator(".sidebar-view-switch");
  if (await viewSwitch.getAttribute("data-target-view") === "tree") await viewSwitch.click();
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
  await editor.press("End");
  await editor.press("Enter");
  await editor.type('console.log("done");');
  await expect(block.locator(".hljs-string")).toContainText('"done"');

  await language.selectOption("");
  await expect(block.locator('[class*="hljs-"]')).toHaveCount(0);
  await language.selectOption("typescript");
  await expect(block.locator(".hljs-keyword")).toContainText("const");

  await page.locator(".properties-panel .prop-readonly-toggle").click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(language).toBeDisabled();

  const popupPromise = page.waitForEvent("popup");
  await page.locator(".properties-panel").getByRole("button", { name: "导出 PDF（含目录）" }).click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");
  await expect(printPage.locator(".document-content .hljs-keyword")).toContainText("const");
  await expect(printPage.locator(".code-block-language, .code-block-copy, [data-pdf-exclude]")).toHaveCount(0);
  await printPage.close();

  // Tauri/WebView2 禁止 window.open；桌面导出必须通过同一 WebView 内的
  // 隔离打印文档调用 window.print。
  await page.evaluate(() => {
    const target = window as typeof window & {
      isTauri?: boolean;
      __desktopPrintCalled?: boolean;
      __desktopWindowOpenCalled?: boolean;
    };
    target.isTauri = true;
    target.__desktopPrintCalled = false;
    target.__desktopWindowOpenCalled = false;
    window.open = () => {
      target.__desktopWindowOpenCalled = true;
      return null;
    };
    const observer = new MutationObserver((_records, instance) => {
      const frame = document.querySelector<HTMLIFrameElement>('iframe[title="PDF 打印文档"]');
      if (!frame?.contentWindow) return;
      instance.disconnect();
      frame.contentWindow.print = () => {
        target.__desktopPrintCalled = true;
        frame.contentWindow?.dispatchEvent(new Event("afterprint"));
      };
    });
    observer.observe(document.body, { childList: true });
  });
  await page.locator(".properties-panel").getByRole("button", { name: "导出 PDF（含目录）" }).click();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __desktopPrintCalled?: boolean }
  ).__desktopPrintCalled)).toBe(true);
  expect(await page.evaluate(() => (
    window as typeof window & { __desktopWindowOpenCalled?: boolean }
  ).__desktopWindowOpenCalled)).toBe(false);
});
