import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

test("屏外 Mermaid 延迟挂载，滚动后渲染且正文模型保持完整", async ({ page }) => {
  await createBlankDocument(page);
  await page.locator(".note-editor .ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [
      ...Array.from({ length: 100 }, (_, index) => ({ type: "paragraph", content: [{ type: "text", text: "Paragraph " + index }] })),
      { type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "flowchart LR\nA --> B" }] },
    ] }, true);
    editor.commands.setTextSelection(1);
  });
  const block = page.locator(".note-editor .code-block-wrap");
  await expect(block.locator(".deferred-mermaid-diagram")).toBeAttached();
  await expect(block.locator(".mermaid-diagram svg")).toHaveCount(0);
  await expect(block.locator("pre code")).toHaveText("flowchart LR\nA --> B");
  await block.scrollIntoViewIfNeeded();
  await expect(block.locator(".mermaid-diagram svg")).toBeVisible();
  await page.locator(".note-editor .ProseMirror p").first().scrollIntoViewIfNeeded();
  await expect(block.locator(".mermaid-diagram svg")).toHaveCount(1);
  const count = await page.locator(".note-editor .ProseMirror").evaluate(element =>
    (element as HTMLElement & { editor: Editor }).editor.state.doc.childCount);
  expect(count).toBe(101);
});

test("代码块屏外保留可编辑正文，进入视口后才测量行号", async ({ page }) => {
  await createBlankDocument(page);
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const settings = await load("/src/lib/block-display-settings.ts") as typeof import("../src/lib/block-display-settings");
    settings.saveBlockWorkspacePreferences({ lineNumbers: true });
  });
  await page.locator(".note-editor .ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [
      ...Array.from({ length: 100 }, (_, index) => ({ type: "paragraph", content: [{ type: "text", text: "Paragraph " + index }] })),
      { type: "codeBlock", content: [{ type: "text", text: "first\nsecond\nthird" }] },
    ] }, true);
    editor.commands.setTextSelection(1);
  });
  const block = page.locator(".note-editor .code-block-wrap");
  await expect(block.locator("pre code")).toHaveText("first\nsecond\nthird");
  await expect(block.locator(".code-block-gutter span").first()).toHaveAttribute("style", /height: 1.5em/);
  await block.scrollIntoViewIfNeeded();
  await expect(block.locator(".code-block-gutter span").first()).toHaveAttribute("style", /height: [\d.]+px/);
});
