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
    const host = window as typeof window & { __NR_PRINT_HTML: string; __NR_PRINT_TITLE: string; __TAURI_INTERNALS__: unknown; nativeCalls: string[]; nativeTitles: string[] };
    host.nativeCalls = [];
    host.nativeTitles = [];
    host.__NR_PRINT_TITLE = "原文档名";
    host.__NR_PRINT_HTML = '<html><head><title>原生打印测试</title><style>@media print { .print-actions {display:none} }</style></head><body><div class="print-actions"><button>关闭</button><button class="primary">打印 / 存储为 PDF</button></div><main><h1>中文文档</h1><p>可选择的完整正文</p></main></body></html>';
    host.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "pdf-print-test" } }, invoke: async (command: string, args?: { title?: string }) => { host.nativeCalls.push(command); if (args?.title) host.nativeTitles.push(args.title); if (command === "print_pdf_document" && host.nativeCalls.length === 1) throw new Error("print unavailable"); } };
    window.print = () => { throw new Error("must use native print"); };
  });
  await page.goto("/pdf-print.html");
  await expect(page.getByRole("heading", { name: "中文文档" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("print unavailable");
  await page.getByRole("button", { name: "打印 / 存储为 PDF" }).click();
  await expect(page.getByRole("alert")).toBeEmpty();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { nativeCalls: string[] }).nativeCalls)).toEqual(["print_pdf_document", "print_pdf_document", "plugin:window|close"]);
  expect(await page.evaluate(() => (window as typeof window & { nativeTitles: string[] }).nativeTitles)).toEqual(["原文档名", "原文档名"]);
});

test("PDF 保留渲染后的流程阶段、任务、表格、公式与图表，不导出 flow 源码", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  const popup = page.waitForEvent("popup");
  await page.locator(".ProseMirror:visible").first().evaluate(async element => {
    const { mdToDelta } = await import("/src/lib/md-parser.ts");
    const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
    const { exportDocumentAsPdf } = await import("/src/lib/pdf-export.ts");
    const source = "````flow\n## 输入\n\n**目的**：明确问题。\n\n- [x] 确认输入\n- [ ] 执行方案\n\n## 行动\n\n> 验证最小步骤。\n\n```js\nconst next = 1;\n```\n\n公式 $x^2$。\n\n```mermaid\nflowchart LR\nA[输入] --> B[结果]\n```\n\n## 输出\n\n| 项目 | 结果 |\n| --- | --- |\n| 验证 | 完成 |\n````";
    const editor = (element as HTMLElement & { editor: { commands: { setContent(doc: unknown): void }; getHTML(): string } }).editor;
    editor.commands.setContent(deltaToProseMirror(mdToDelta(source)));
    exportDocumentAsPdf({ title: "流程阅读版", contentHtml: editor.getHTML() });
  });
  const preview = await popup;
  await expect(preview.getByRole("button", { name: "打印 / 存储为 PDF" })).toBeEnabled();
  await expect(preview.locator(".print-flow-step")).toHaveCount(3);
  expect(await preview.locator(".print-flow-number").allTextContents()).toEqual(["1", "2", "3"]);
  await expect(preview.locator('pre[data-language="flow"]')).toHaveCount(0);
  await expect(preview.locator(".print-flow strong")).toHaveText("目的");
  await expect(preview.locator(".print-flow blockquote")).toContainText("验证最小步骤");
  await expect(preview.locator(".print-flow table")).toHaveCount(1);
  await expect(preview.locator(".print-flow .katex")).toHaveCount(1);
  await expect(preview.locator(".print-flow .print-mermaid svg")).toHaveCount(1);
  await expect(preview.locator(".print-task-checkbox")).toHaveCount(2);
  await expect(preview.locator(".print-task-checkbox").first()).toBeChecked();
  await expect(preview.locator(".print-task-checkbox").last()).not.toBeChecked();
  await expect(preview.locator(".print-flow pre code")).toContainText("const next = 1;");
});

test("PDF 六级标题字号完整，H3 流程步骤与 H4 分支保持层级", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  const popup = page.waitForEvent("popup");
  await page.evaluate(async () => {
    const { exportDocumentAsPdf } = await import("/src/lib/pdf-export.ts");
    const headings = Array.from({ length: 6 }, (_, i) => `<h${i + 1}>标题 ${i + 1}</h${i + 1}>`).join("");
    exportDocumentAsPdf({ title: "标题排版", contentHtml: `${headings}<p>普通正文</p><pre data-language="flow"><code>### 输入\n\n正文\n\n#### 条件分支\n\n分支说明\n\n### 输出\n\n完成</code></pre>` });
  });
  const preview = await popup;
  await expect(preview.getByRole("button", { name: "打印 / 存储为 PDF" })).toBeEnabled();
  for (const [index, size] of [28, 23, 19, 16, 15, 15].entries()) {
    await expect(preview.getByRole("heading", { name: `标题 ${index + 1}`, exact: true })).toHaveCSS("font-size", `${size}px`);
  }
  await expect(preview.getByText("普通正文", { exact: true })).toHaveCSS("font-size", "15px");
  await expect(preview.locator(".print-flow-step")).toHaveCount(2);
  await expect(preview.locator(".print-flow-step > h3")).toHaveCount(2);
  await expect(preview.locator(".print-flow h4")).toHaveText("条件分支");
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
