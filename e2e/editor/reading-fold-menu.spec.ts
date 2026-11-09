import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "../helpers/document";
import { closeDocumentSidebar } from "../helpers/workspace";

for (const width of [1280, 390]) test(`阅读折叠级别菜单跟随实际点击的顶部或选区按钮 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => localStorage.setItem("nr:experimentalReadonlyRendering", "false"));
  await createBlankDocument(page, "阅读菜单定位");
  await closeDocumentSidebar(page);
  const content = page.locator(".note-editor .editor-content > .ProseMirror:visible");
  await content.evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [1, 2, 3].flatMap(level => [
      { type: "heading", attrs: { level }, content: [{ type: "text", text: `标题 ${level}` }] },
      { type: "paragraph", content: [{ type: "text", text: "选择这段正文打开浮动阅读工具。" }] },
    ]) }, true);
  });
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await page.setViewportSize({ width, height: 900 });
  const toolbar = page.getByRole("toolbar", { name: "文档阅读工具", exact: true });
  const menu = page.getByRole("menu", { name: "标题折叠级别", exact: true });
  for (const floating of width > 768 ? [false, true] : [false]) {
    let surface = toolbar;
    if (floating) {
      const paragraph = content.locator("p").nth(2);
      await paragraph.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        document.getSelection()!.removeAllRanges();
        document.getSelection()!.addRange(range);
      });
      const rect = (await paragraph.boundingBox())!;
      await page.mouse.move(rect.x + 15, rect.y + rect.height / 2);
      surface = page.getByRole("toolbar", { name: "选区编辑工具", exact: true });
      await expect(surface).toBeVisible();
    }
    const trigger = surface.getByRole("button", { name: "选择标题折叠级别", exact: true });
    await trigger.click();
    await expect(menu).toBeVisible();
    const anchor = (await trigger.boundingBox())!;
    await expect.poll(async () => {
      const popup = (await menu.boundingBox())!;
      return Math.abs(popup.y - (anchor.y + anchor.height + 6));
    }).toBeLessThan(2);
    const popup = (await menu.boundingBox())!;
    const expectedLeft = Math.max(8, Math.min(anchor.x, width - popup.width - 8));
    expect(Math.abs(popup.x - expectedLeft)).toBeLessThan(2);
    expect(popup.x + popup.width).toBeLessThanOrEqual(width - 8);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  }
});
