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
