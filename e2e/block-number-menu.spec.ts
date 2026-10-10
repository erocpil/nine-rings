import { expect, test, type Page } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";

async function setup(page: Page, readonly = false, virtual = false) {
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.addInitScript(virtual => {
    localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true }));
    localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual));
  }, virtual);
  await createBlankDocument(page, "块号菜单");
  await closeDocumentSidebar(page);
  await page.locator(".ProseMirror:visible").evaluate((element) => {
    const editor = (element as any).editor;
    editor.commands.setContent({ type: "doc", content: ["first", "second", "third"].map(text => ({ type: "paragraph", content: [{ type: "text", text }] })) }, true);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  });
  if (readonly) {
    await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    if (virtual) await expect(page.locator("[data-virtual-reader]")).toBeVisible();
  }
  await page.setViewportSize(viewport);
  await expect(page.locator(".editor-block-number").first()).toBeVisible();
}
const menu = (page: Page) => page.getByRole("menu", { name: "第 1 块", exact: true });
async function open(page: Page) { await page.getByRole("button", { name: "第 1 块操作", exact: true }).click(); await expect(menu(page)).toBeVisible(); }

test("结构块复制保留 Markdown，折叠操作和菜单键盘关闭不改写内容", async ({ page }) => {
  await setup(page);
  const root = page.locator(".ProseMirror:visible");
  await root.evaluate(element => {
    (element as any).editor.commands.setContent({ type: "doc", content: [{ type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "const x = 1;" }] }, { type: "paragraph", content: [{ type: "text", text: "after" }] }] }, true);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as any).blockCopied = text; } } });
  });
  await open(page);
  await menu(page).getByRole("menuitem", { name: "复制 Markdown", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).blockCopied)).toMatch(/```javascript\nconst x = 1;\n```/);
  await open(page);
  await menu(page).getByRole("menuitem", { name: "折叠 / 展开此块", exact: true }).click();
  await expect(root.locator(".code-block-wrap")).toHaveClass(/collapsed/);
  await open(page);
  await page.keyboard.press("End");
  await expect(menu(page).getByRole("menuitem", { name: "删除此块", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  expect(await root.evaluate(element => (element as any).editor.state.doc.textContent)).toBe("const x = 1;after");
});

test("分割线缩进只作用于此块，不把下一个段落当成目标", async ({ page }) => {
  await setup(page);
  const root = page.locator(".ProseMirror:visible");
  await root.evaluate(element => (element as any).editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "before" }] }, { type: "horizontalRule" }, { type: "paragraph", content: [{ type: "text", text: "after" }] }] }, true));
  await page.getByRole("button", { name: "第 2 块操作", exact: true }).click();
  const popup = page.getByRole("menu", { name: "第 2 块", exact: true });
  await expect(popup.getByRole("menuitem", { name: "添加块书签", exact: true })).toBeDisabled();
  await popup.getByRole("menuitem", { name: "增加缩进", exact: true }).click();
  expect(await root.evaluate(element => {
    const doc = (element as any).editor.state.doc;
    return [doc.child(1).attrs.indent, doc.child(2).attrs.indent];
  })).toEqual([1, 0]);
});

test("块号菜单针对点击块操作，复制副本、删除、转换可撤销，支持多选", async ({ page }) => {
  await setup(page);
  const root = page.locator(".ProseMirror:visible");
  const before = await root.evaluate(element => (element as any).editor.state.selection.from);
  await open(page);
  expect(await root.evaluate(element => (element as any).editor.state.selection.from)).toBe(before);
  await page.getByRole("button", { name: "第 1 块操作", exact: true }).click();
  await expect(menu(page)).toHaveCount(0);
  await open(page);
  await page.getByRole("button", { name: "第 3 块操作", exact: true }).click();
  await expect(page.getByRole("menu", { name: "第 3 块", exact: true })).toBeVisible();
  await expect(menu(page)).toHaveCount(0);
  await open(page);
  await menu(page).getByRole("menuitem", { name: "复制副本", exact: true }).click();
  await expect(root.locator(":scope > p")).toHaveText(["first", "first", "second", "third"]);
  await root.evaluate(element => (element as any).editor.commands.undo());
  await open(page);
  await menu(page).getByRole("menuitem", { name: "删除此块", exact: true }).click();
  await expect(root.locator(":scope > p")).toHaveText(["second", "third"]);
  await root.evaluate(element => (element as any).editor.commands.undo());
  await open(page);
  await menu(page).getByRole("menuitem", { name: "转换类型", exact: false }).click();
  await menu(page).getByRole("menuitem", { name: "H3", exact: true }).click();
  await expect(root.locator("h3")).toHaveText("first");
  await root.evaluate(element => (element as any).editor.commands.undo());
  await open(page);
  await menu(page).getByRole("menuitem", { name: "选择多个块", exact: true }).click();
  await page.getByRole("button", { name: "选择第 2 块", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "块级操作" })).toContainText("2 块");
});

for (const virtual of [false, true]) test(`只读块号菜单可复制和添加书签，不显示正文修改，局部=${virtual}`, async ({ page }) => {
  await setup(page, true, virtual);
  await open(page);
  await page.getByRole("button", { name: "第 1 块操作", exact: true }).click();
  await expect(menu(page)).toHaveCount(0);
  await open(page);
  await expect(menu(page).getByRole("menuitem", { name: "复制块引用", exact: true })).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "删除此块", exact: true })).toHaveCount(0);
  await menu(page).getByRole("menuitem", { name: "添加块书签", exact: true }).click();
  await open(page);
  await expect(menu(page).getByRole("menuitem", { name: "取消块书签", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "第 1 块操作", exact: true })).toBeFocused();
});

test.describe("手机块类型预览", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  for (const virtual of [false, true]) test(`右划显示类型、松开恢复且不弹菜单，轻点仍打开，局部=${virtual}`, async ({ page }) => {
    await setup(page, virtual, virtual);
    const number = page.getByRole("button", { name: "第 1 块操作", exact: true });
    await number.evaluate(element => {
      const event = new Event("touchstart", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: [{ identifier: 1, clientX: 20, clientY: 200 }] });
      element.dispatchEvent(event);
      const move = new Event("touchmove", { bubbles: true, cancelable: true });
      Object.defineProperty(move, "touches", { value: [{ identifier: 1, clientX: 65, clientY: 201 }] });
      element.dispatchEvent(move);
    });
    await expect(number).toHaveClass(/block-type-preview/);
    await expect.poll(() => number.evaluate(element => getComputedStyle(element, "::after").visibility)).toBe("visible");
    await number.evaluate(element => {
      const event = new Event("touchend", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "changedTouches", { value: [{ identifier: 1, clientX: 65, clientY: 201 }] });
      element.dispatchEvent(event);
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect(number).not.toHaveClass(/block-type-preview/);
    await expect.poll(() => number.evaluate(element => getComputedStyle(element, "::after").visibility)).toBe("hidden");
    await expect(menu(page)).toHaveCount(0);
    await number.tap();
    await expect(menu(page)).toBeVisible();
    const rect = (await menu(page).boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(8);
    expect(rect.x + rect.width).toBeLessThanOrEqual(382);
    expect(rect.y + rect.height).toBeLessThanOrEqual(836);
    await number.tap();
    await expect(menu(page)).toHaveCount(0);
    await number.tap();
    await expect(menu(page)).toBeVisible();
  });
});
