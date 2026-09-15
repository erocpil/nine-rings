import { expect, test, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";

async function fixture(page: Page) {
  await page.goto("/");
  const content = page.locator(".note-editor .ProseMirror");
  await expect(content).toBeVisible();
  await content.evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "Default paragraph" }] },
      { type: "blockquote", content: [
        { type: "paragraph", content: [{ type: "text", text: "Quoted first line", marks: [{ type: "textStyle", attrs: { fontSize: "18" } }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Quoted second line", marks: [{ type: "textStyle", attrs: { fontSize: "24" } }] }] },
      ] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Inherited heading" }] },
    ] });
  });
  return content;
}

async function selectText(page: Page, text: string, endText?: string) {
  await page.locator(".note-editor .ProseMirror").evaluate((element, { text, endText }) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    let from = 0;
    let to = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === text) from = pos;
      if (node.isText && node.text === endText) to = pos + node.nodeSize;
    });
    editor.chain().focus().setTextSelection(endText ? { from, to } : from + 2).run();
  }, { text, endText });
}

test("桌面引用块多段选区可直接点击字号菜单，格式和撤销保留完整选区", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const editor = await fixture(page);
  const toolbar = page.locator(".editor-menu");
  await expect(toolbar).toHaveClass(/toolbar-full/);
  await selectText(page, "Quoted first line", "Quoted second line");
  await toolbar.getByTitle("字号", { exact: true }).click();
  const option = toolbar.getByRole("button", { name: "32px", exact: true });
  await expect(option).toBeVisible();
  expect(await option.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return el === hit || el.contains(hit);
  })).toBe(true);
  await option.click();
  const quote = editor.locator("blockquote p");
  for (const paragraph of await quote.all()) await expect(paragraph.locator("span").first()).toHaveCSS("font-size", "32px");
  await expect(editor.locator(":scope > p")).not.toHaveCSS("font-size", "32px");
  await toolbar.getByTitle("撤销 (Ctrl+Z)").click();
  await expect(quote.nth(0).locator("span").first()).toHaveCSS("font-size", "18px");
  await expect(quote.nth(1).locator("span").first()).toHaveCSS("font-size", "24px");
});

for (const mobile of [false, true]) {
  test(`字号随光标、继承字号及待输入格式实时变化：${mobile ? "手机" : "桌面"}`, async ({ page }) => {
    // Keep the size control in the visible row on both browser font metrics;
    // narrower overflow behavior is covered by mobile-toolbar-fit.spec.ts.
    await page.setViewportSize(mobile ? { width: 480, height: 844 } : { width: 1600, height: 900 });
    const editor = await fixture(page);
    const size = page.locator(".editor-menu").getByTitle("字号", { exact: true });
    await selectText(page, "Default paragraph");
    const inherited = await editor.locator(":scope > p").evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    await expect(size).toHaveText(`${inherited}▾`);
    await selectText(page, "Quoted first line");
    await expect(size).toHaveText("18▾");
    await selectText(page, "Quoted second line");
    await expect(size).toHaveText("24▾");
    await size.click();
    await page.locator("[data-toolbar-tool=size]").getByRole("button", { name: "20px", exact: true }).click();
    await expect(size).toHaveText("20▾");
    await size.click();
    await page.locator("[data-toolbar-tool=size]").getByRole("button", { name: "清除", exact: true }).click();
    await expect(size).toHaveText(`${inherited}▾`);
    await selectText(page, "Inherited heading");
    const headingSize = await editor.locator("h2").evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    await expect(size).toHaveText(`${Math.round(headingSize * 100) / 100}▾`);
  });
}
