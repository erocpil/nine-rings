import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

test("Mermaid 代码块保留源码并可在图形与源码间切换", async ({ page }) => {
  await createBlankDocument(page);
  const source = "flowchart LR\n  A[开始] --> B[完成]";
  await page.locator(".note-editor .ProseMirror").evaluate((element, value) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [{
      type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: value }],
    }] }, true);
  }, source);
  const block = page.locator(".note-editor .code-block-wrap");
  await expect(block.getByLabel("代码语言")).toHaveValue("mermaid");
  await expect(block.locator(".mermaid-diagram svg")).toBeVisible();
  await expect(block.locator("pre code")).toHaveText(source);
  await block.getByRole("button", { name: "显示 Mermaid 源码" }).click();
  await expect(block.locator("pre code")).toBeVisible();
  await expect(block.locator("pre code")).toHaveText(source);
  await block.getByRole("button", { name: "显示 Mermaid 图形" }).click();
  await expect(block.locator(".mermaid-diagram svg")).toBeVisible();
  await expect(block.locator("pre code")).toHaveText(source);
  await block.getByRole("button", { name: "折叠代码块" }).click();
  await expect(block.locator(".mermaid-diagram")).toHaveCount(0);
  await block.getByRole("button", { name: "展开代码块" }).click();
  await expect(block.locator(".mermaid-diagram svg")).toBeVisible();
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(block.locator(".mermaid-diagram svg")).toBeVisible();
  await block.getByRole("button", { name: "显示 Mermaid 源码" }).click();
  await expect(block.locator("pre code")).toBeVisible();
  await expect(block.locator("pre code")).toHaveText(source);
});

test("无效 Mermaid 保留切回源码的入口", async ({ page }) => {
  await createBlankDocument(page);
  await page.locator(".note-editor .ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [{
      type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "not a diagram" }],
    }] }, true);
  });
  const block = page.locator(".note-editor .code-block-wrap");
  await expect(block.locator(".mermaid-diagram-error")).toBeVisible();
  await block.getByRole("button", { name: "显示 Mermaid 源码" }).click();
  await expect(block.locator("pre code")).toBeVisible();
});

test("PDF 打印视图将 Mermaid 源码绘制成图形", async ({ page }) => {
  await page.goto("/");
  const rendered = await page.evaluate(async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const printWindow = frame.contentWindow!;
    printWindow.print = () => undefined;
    const originalOpen = window.open;
    window.open = (() => printWindow) as typeof window.open;
    try {
      const { exportDocumentAsPdf } = await import("../src/lib/pdf-export");
      exportDocumentAsPdf({
        title: "Mermaid 导出",
        contentHtml: '<pre data-language="mermaid"><code>flowchart LR\nA--&gt;B</code></pre>',
      });
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (printWindow.document.querySelector(".print-mermaid svg")) return true;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return false;
    } finally {
      window.open = originalOpen;
      frame.remove();
    }
  });
  expect(rendered).toBe(true);
});

test("Mermaid 弹层支持滚轮缩放、拖动和适应窗口", async ({ page }) => {
  await createBlankDocument(page);
  await page.locator(".note-editor .ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [{
      type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "flowchart LR\nA --> B" }],
    }] }, true);
  });
  await page.locator(".note-editor .code-block-wrap").getByRole("button", { name: "放大阅读代码块" }).click();
  const dialog = page.getByRole("dialog", { name: "代码块工作区" });
  const viewport = dialog.locator(".mermaid-diagram-viewport");
  await expect(viewport.locator("svg")).toBeVisible();
  await expect(dialog.getByRole("status").filter({ hasText: "100%" })).toBeVisible();

  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThan(300);
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -300);
  await expect(dialog.getByRole("status").filter({ hasText: "100%" })).toHaveCount(0);
  const beforeDrag = await viewport.locator(".mermaid-diagram-canvas").getAttribute("style");
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 35, { steps: 5 });
  await page.mouse.up();
  await expect(viewport.locator(".mermaid-diagram-canvas")).not.toHaveAttribute("style", beforeDrag!);
  await dialog.getByRole("button", { name: "适应窗口" }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "100%" })).toBeVisible();
  await expect(viewport.locator(".mermaid-diagram-canvas")).toHaveAttribute("style", /translate\(0px(?:, 0px)?\) scale\(1\)/);
  await dialog.getByRole("group", { name: "Mermaid 视图" }).getByRole("button", { name: "源码" }).click();
  await expect(dialog.locator(".code-block-inner pre code")).toHaveText("flowchart LR\nA --> B");
  await dialog.getByRole("button", { name: "块内查找" }).click();
  await dialog.getByRole("textbox", { name: "在当前块查找" }).fill("A");
  await expect(dialog.getByRole("search", { name: "当前块查找" })).toContainText("1 / 2");
  await dialog.getByRole("group", { name: "Mermaid 视图" }).getByRole("button", { name: "图形" }).click();
  await expect(dialog.locator(".mermaid-diagram-viewport svg")).toBeVisible();
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(dialog.locator(".cm-content")).toBeVisible();
  await dialog.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(dialog.locator(".mermaid-diagram-viewport svg")).toBeVisible();
});

test("手机 Mermaid 弹层支持双指缩放和单指拖动", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "触摸事件通过 Chromium CDP 注入");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await expect(page.locator(".note-editor .ProseMirror")).toBeEditable();
    await page.locator(".note-editor .ProseMirror").evaluate(element => {
      const editor = (element as HTMLElement & { editor: Editor }).editor;
      editor.commands.setContent({ type: "doc", content: [{
        type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "flowchart LR\nA --> B" }],
      }] }, true);
    });
    await page.locator(".note-editor .code-block-wrap").getByRole("button", { name: "放大阅读代码块" }).click();
    const viewport = page.getByRole("dialog", { name: "代码块工作区" }).locator(".mermaid-diagram-viewport");
    await expect(viewport.locator("svg")).toBeVisible();
    const box = (await viewport.boundingBox())!;
    expect(box.height).toBeGreaterThan(250);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const cdp = await context.newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: Array<{ id: number; x: number; y: number }>) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    await touch("touchStart", [{ id: 1, x: x - 30, y }, { id: 2, x: x + 30, y }]);
    await touch("touchMove", [{ id: 1, x: x - 75, y }, { id: 2, x: x + 75, y }]);
    await touch("touchEnd", []);
    const canvas = viewport.locator(".mermaid-diagram-canvas");
    await expect.poll(async () => Number((await page.getByRole("dialog", { name: "代码块工作区" }).locator(".mermaid-diagram-controls [role=status]").textContent())?.replace("%", ""))).toBeGreaterThan(100);
    const beforePan = await canvas.getAttribute("style");
    await touch("touchStart", [{ id: 3, x, y }]);
    await touch("touchMove", [{ id: 3, x: x + 60, y: y + 35 }]);
    await touch("touchEnd", []);
    await expect(canvas).not.toHaveAttribute("style", beforePan!);
  } finally {
    await context.close();
  }
});
