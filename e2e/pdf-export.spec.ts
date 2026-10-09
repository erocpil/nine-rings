import { pressLineBoundary } from "./helpers/keyboard";
import { expect, test } from "@playwright/test";

test("桌面 PDF 导出把准备好的独立文档交给原生窗口并报告创建错误", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  const result = await page.evaluate(async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    const host = window as typeof window & { __TAURI_INTERNALS__?: unknown };
    host.__TAURI_INTERNALS__ = { invoke: async (command: string, args: Record<string, unknown>) => { calls.push({ command, args }); } };
    const { exportDocumentAsPdf } = await import("/src/lib/pdf-export.ts");
    const opened = exportDocumentAsPdf({ title: "原生导出", contentHtml: '<h2>标题</h2><p>中文正文</p><script>throw new Error("must not run")</script>' });
    for (let attempt = 0; attempt < 100 && !calls.length; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    let error = "";
    host.__TAURI_INTERNALS__ = { invoke: async () => { throw new Error("cannot create window"); } };
    exportDocumentAsPdf({ title: "失败测试", contentHtml: "<p>body</p>", onError: reason => { error = reason.message; } });
    for (let attempt = 0; attempt < 100 && !error; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    delete host.__TAURI_INTERNALS__;
    return { opened, calls, error, frames: document.querySelectorAll('iframe[title="PDF 打印文档"]').length };
  });
  expect(result.opened).toBe(true);
  expect(result.calls[0].command).toBe("open_pdf_print_preview");
  expect(result.calls[0].args.html).toContain("中文正文");
  expect(result.calls[0].args.html).not.toContain("must not run");
  expect(result.error).toBe("cannot create window");
  expect(result.frames).toBe(0);
});

test("原生打印页展示完整正文并通过原生接口打印、重试和关闭", async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as typeof window & { __NR_PRINT_HTML: string; __TAURI_INTERNALS__: unknown; nativeCalls: string[] };
    host.nativeCalls = [];
    host.__NR_PRINT_HTML = '<html><head><title>原生打印测试</title><style>@media print { .print-actions {display:none} }</style></head><body><div class="print-actions"><button>关闭</button><button class="primary">打印 / 存储为 PDF</button></div><main><h1>中文文档</h1><p>可选择的完整正文</p></main></body></html>';
    host.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "pdf-print-test" } }, invoke: async (command: string) => { host.nativeCalls.push(command); if (command === "print_pdf_document" && host.nativeCalls.length === 1) throw new Error("print unavailable"); } };
    window.print = () => { throw new Error("must use native print"); };
  });
  await page.goto("/pdf-print.html");
  await expect(page.getByRole("heading", { name: "中文文档" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("print unavailable");
  await page.getByRole("button", { name: "打印 / 存储为 PDF" }).click();
  await expect(page.getByRole("alert")).toBeEmpty();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { nativeCalls: string[] }).nativeCalls)).toEqual(["print_pdf_document", "print_pdf_document", "plugin:window|close"]);
});

test("PDF 打印视图用语义标题生成侧栏书签且不在正文插入目录", async ({ page, browserName }) => {
  await page.goto("/");
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill("书签大纲导出测试");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByTitle("显示属性面板").click();

  const editor = page.locator(".ProseMirror");
  await editor.fill("导出标题");
  await editor.press("ControlOrMeta+Alt+1");
  await pressLineBoundary(editor, "end");
  await editor.press("Enter");
  await editor.type("折叠后仍应导出的正文");
  await pressLineBoundary(editor, "end");
  await editor.press("Enter");
  await editor.type("子章节");
  await editor.press("ControlOrMeta+Alt+2");
  await pressLineBoundary(editor, "end");
  await editor.press("Enter");
  await editor.press("ControlOrMeta+Alt+c");
  await editor.type("const exported = true;");

  const foldToggle = page.locator(".editor-heading-fold").first();
  await expect(foldToggle).toBeVisible();
  await foldToggle.click();
  await expect(editor.getByText("折叠后仍应导出的正文", { exact: true })).toBeHidden();

  const popupPromise = page.waitForEvent("popup");
  await page.locator(".properties-panel").getByRole("button", { name: "导出 PDF（书签大纲）" }).click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");

  await expect(printPage.locator(".document-content")).toContainText("折叠后仍应导出的正文");
  await expect(printPage.locator(".document-content")).toContainText("const exported = true;");
  await expect(printPage.locator(".ProseMirror-activeline, .heading-fold-hidden, .code-block-copy, [data-pdf-exclude]")).toHaveCount(0);
  await expect(printPage.locator(".toc, nav[aria-label='目录']")).toHaveCount(0);

  const outlineHeadings = printPage.locator(".print-document h1, .print-document h2");
  await expect(outlineHeadings).toHaveCount(3);
  await expect(outlineHeadings.nth(0)).toHaveAttribute("id", "document-title");
  await expect(outlineHeadings.nth(1)).toHaveAttribute("id", /\S+/);
  await expect(outlineHeadings.nth(2)).toHaveAttribute("id", /\S+/);

  test.skip(browserName !== "chromium", "Playwright 的 page.pdf 仅支持 Chromium；打印视图结构已跨浏览器验证");
  const pdf = await printPage.pdf({ format: "A4", outline: true, tagged: true });
  expect(pdf.toString("latin1")).toContain("/Outlines");
});
