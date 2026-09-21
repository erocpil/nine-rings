import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

test("# 空格后提交中文组合输入时保持在一级标题", async ({ page }) => {
  await createBlankDocument(page);
  const root = page.locator(".ProseMirror");
  await root.click();
  await page.keyboard.type("# ");
  await root.evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    editor.commands.insertContent("中文标题");
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文标题" }));
  });
  await expect(root.locator(":scope > h1")).toHaveText("中文标题");
  await expect(root.locator(":scope > p")).toHaveCount(0);
});

test("# 空格后输入普通文字仍转换为一级标题", async ({ page }) => {
  await createBlankDocument(page);
  const root = page.locator(".ProseMirror");
  await root.click();
  await page.keyboard.type("# heading");
  await expect(root.locator(":scope > h1")).toHaveText("heading");
});
