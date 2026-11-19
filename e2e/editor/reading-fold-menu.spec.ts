import { expectFoldContextSubmenu } from "../helpers/context-submenu";
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

for (const style of ["classic", "calm"]) test(`右键标题级别子菜单保留关闭前锚点并左右避让 ${style}`, async ({ page }) => {
  await page.addInitScript(style => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: style })), style);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => localStorage.setItem("nr:experimentalReadonlyRendering", "false"));
  await createBlankDocument(page, "右键菜单定位");
  await closeDocumentSidebar(page);
  const content = page.locator(".note-editor .editor-content > .ProseMirror:visible");
  await content.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.commands.setContent({ type: "doc", content: [1, 2, 3].flatMap(level => [
    { type: "heading", attrs: { level }, content: [{ type: "text", text: `标题 ${level}` }] },
    { type: "paragraph", content: [{ type: "text", text: "正文。" }] },
  ]) }, true));
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  for (const x of [20, 1000]) await expectFoldContextSubmenu(page, content, x);
  // A later direct toolbar invocation must not reuse a detached context anchor.
  const button = page.getByRole("toolbar", { name: "文档阅读工具", exact: true }).getByRole("button", { name: "选择标题折叠级别", exact: true });
  await button.click();
  const anchor = (await button.boundingBox())!;
  const popup = (await page.getByRole("menu", { name: "标题折叠级别", exact: true }).boundingBox())!;
  expect(Math.abs(popup.y - anchor.y - anchor.height - 6)).toBeLessThan(2);
});

for (const style of ["classic", "calm"]) test(`查找和跳转块浮层跟随入口且不覆盖标题 ${style}`, async ({ page }) => {
  await page.addInitScript(style => {
    localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: style }));
    localStorage.setItem("nr:experimentalReadonlyRendering", "false");
  }, style);
  await createBlankDocument(page, "工具浮层定位");
  await closeDocumentSidebar(page);
  await page.locator(".ProseMirror[contenteditable=true]").fill("第一块正文\n第二块正文");
  const find = page.getByRole("button", { name: "查找与替换", exact: true }).first();
  await find.click();
  const search = page.getByRole("search", { name: "文档查找", exact: true });
  const findBox = (await find.boundingBox())!;
  await expect.poll(async () => (await search.boundingBox())!.y - findBox.y - findBox.height).toBeCloseTo(6, 0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  const jump = page.getByRole("button", { name: "跳转块", exact: true });
  const panel = page.getByRole("dialog", { name: "跳转块", exact: true });
  const before = await page.locator(".note-editor-scroll").boundingBox();
  await jump.click();
  const jumpBox = (await jump.boundingBox())!;
  await expect.poll(async () => (await panel.boundingBox())!.y - jumpBox.y - jumpBox.height).toBeCloseTo(6, 0);
  expect(await page.locator(".note-editor-scroll").boundingBox()).toEqual(before);
  await jump.click(); await expect(panel).toHaveCount(0);
  // A context command keeps its detached button's side anchor.
  await page.locator(".ProseMirror:visible > p").first().click({ button: "right", position: { x: 70, y: 10 } });
  const context = page.getByRole("menu", { name: "正文操作", exact: true });
  await context.getByRole("button", { name: "文档", exact: true }).click();
  const item = context.getByRole("button", { name: "跳转块", exact: true });
  const itemBox = (await item.boundingBox())!;
  await item.click();
  await expect(panel).toBeVisible();
  const popup = (await panel.boundingBox())!;
  expect(popup.x).toBeCloseTo(itemBox.x + itemBox.width + 6, 0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+g");
  await expect(panel).toBeVisible();
  const title = (await page.locator(".document-render-header:visible").boundingBox())!;
  expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(title.y + title.height);
  await page.keyboard.press("Escape");
});

test("可编辑右键字号级联保留父菜单、逐层返回并仅执行一次格式动作", async ({ page }) => {
  await createBlankDocument(page, "字号级联");
  await closeDocumentSidebar(page);
  const content = page.locator(".ProseMirror:visible");
  await content.fill("Selected content");
  await content.evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
  });
  await content.locator("p").click({ button: "right" });
  const root = page.getByRole("menu", { name: "正文操作", exact: true });
  await root.getByRole("button", { name: "文字格式", exact: true }).hover();
  const trigger = root.getByRole("button", { name: "字号", exact: true });
  await trigger.hover();
  const child = page.locator('.menu-dropdown[data-toolbar-tool="size"] .menu-dropdown-list');
  await expect(child).toBeVisible();
  await expect(root).toBeVisible();
  await expect(root.getByRole("group", { name: "文字格式", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(child).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(child).toBeVisible();
  await child.getByRole("button", { name: "24px", exact: true }).click();
  await expect(root).toHaveCount(0);
  await expect(child).toHaveCount(0);
  await expect(content.locator('span[style*="font-size"]')).toHaveCSS("font-size", "24px");
  await content.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(content.locator('span[style*="font-size"]')).toHaveCount(0);
});
