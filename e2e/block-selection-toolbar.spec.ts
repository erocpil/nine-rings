import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";

for (const width of [390, 1280]) {
  test(`多块工具栏图标、关闭对齐与不连续剪切撤销 ${width}`, async ({ page }) => {
    await createBlankDocument(page);
    await closeDocumentSidebar(page);
    await page.setViewportSize({ width, height: 800 });
    const editor = page.locator(".ProseMirror:visible");
    await editor.evaluate(element => {
      const editor = (element as HTMLElement & { editor: Editor }).editor;
      editor.commands.setContent({ type: "doc", content: ["first", "middle", "last"].map(text => ({ type: "paragraph", content: [{ type: "text", text }] })) }, true);
      editor.commands.setTextSelection(1);
    });
    await page.getByRole("button", { name: "块级操作", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "选择多个块", exact: true }).click();
    await editor.getByText("last", { exact: true }).click();
    const toolbar = page.getByRole("toolbar", { name: "块级操作" });
    await expect(toolbar).toContainText("2 块");
    for (const name of ["复制", "编辑", "剪切", "删除所选块", "清除文字样式", "粗体", "斜体", "引用", "退出块选择"]) {
      const button = toolbar.getByRole("button", { name, exact: true });
      await expect(button).toHaveAttribute("title", name);
      await expect(button.locator("svg")).toHaveCount(1);
      await expect(button).toHaveText("");
    }
    const rightGap = await toolbar.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.right - element.querySelector(".block-selection-close")!.getBoundingClientRect().right;
    });
    expect(rightGap).toBeLessThan(12);
    await toolbar.getByRole("button", { name: "剪切", exact: true }).click();
    await expect(editor).toHaveText("middle");
    await expect(toolbar).toHaveCount(0);
    await expect(editor).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor).toHaveText("firstmiddlelast");
  });
}

test("选中折叠标题明确排除章节正文，文字颜色使用调色盘图标", async ({ page }) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  const editor = page.locator(".ProseMirror:visible");
  await editor.evaluate(element => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    instance.commands.setContent({ type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Selected heading" }] },
      { type: "paragraph", content: [{ type: "text", text: "Unselected body" }] },
    ] }, true);
    instance.commands.setTextSelection(1);
  });
  await editor.evaluate(async element => {
    const path = "/src/extensions/HeadingFold.ts";
    const { toggleHeadingFold } = await import(/* @vite-ignore */ path);
    toggleHeadingFold((element as HTMLElement & { editor: Editor }).editor, 0);
  });
  await expect(editor.locator("p")).toBeHidden();
  await page.getByRole("button", { name: "块级操作", exact: true }).first().click();
  await page.getByRole("menuitem", { name: "选择多个块", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "标题块仅包含标题本身" })).toBeVisible();
  const color = page.getByRole("toolbar", { name: "块级操作" }).locator('.block-selection-color');
  await expect(color.locator("svg")).toHaveCount(1);
  await expect(color).not.toContainText("A");
  await page.getByRole("toolbar", { name: "块级操作" }).getByRole("button", { name: "复制", exact: true }).click();
  await expect(page.locator(".ProseMirror:visible")).toContainText("Unselected body");
});
