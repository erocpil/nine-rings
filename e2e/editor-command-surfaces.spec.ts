import { expect, test, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";
async function select(page: Page) {
  const content = page.locator(".ProseMirror");
  await content.evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setTextSelection({ from: 1, to: 6 }); editor.view.focus();
  });
  const rect = await content.locator("p").first().boundingBox();
  await page.mouse.move(rect!.x + 12, rect!.y + rect!.height / 2);
  const hover = page.getByRole("toolbar", { name: "选区编辑工具" });
  await expect(hover).toBeVisible();
  return hover;
}
test("选区弹层的字号颜色剪切实际生效，子菜单锚定选区", async ({ page }) => {
  await createBlankDocument(page);
  const content = page.locator(".ProseMirror");
  await content.fill("first second");
  let hover = await select(page);
  await hover.getByTitle("字号", { exact: true }).click();
  const menu = page.locator(".menu-dropdown-list:visible");
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const anchor = (await hover.boundingBox())!;
  expect(Math.abs(box.y - anchor.y - anchor.height)).toBeLessThan(12);
  await menu.getByRole("button", { name: "24px", exact: true }).click();
  await expect(content.locator('span[style*="font-size"]')).toHaveText("first");
  await expect(content.locator('span[style*="font-size"]')).toHaveCSS("font-size", "24px");
  hover = await select(page);
  await hover.getByTitle("选择文字颜色", { exact: true }).click();
  await page.locator(".color-grid").getByTitle("#22a577", { exact: true }).click();
  await expect(content.locator('span[style*="color"]')).toHaveText("first");
  hover = await select(page);
  await hover.getByTitle("文字颜色", { exact: true }).click();
  await expect(content.locator('span[style*="color"]')).toHaveCSS("color", "rgb(34, 165, 119)");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {}, write: async () => {} } });
  });
  hover = await select(page);
  await hover.getByTitle("剪切 (Ctrl+X)", { exact: true }).click();
  await expect(content).toHaveText(" second");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(content).toHaveText("first second");
});
test("右键菜单覆盖宿主按钮并复用字号与所有标题", async ({ page }) => {
  await createBlankDocument(page);
  const content = page.locator(".ProseMirror");
  await content.fill("first second");
  await select(page);
  await content.locator("p").click({ button: "right", position: { x: 12, y: 8 } });
  const menu = page.getByRole("menu", { name: "正文操作" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "段落", exact: true }).click();
  for (let level = 1; level <= 6; level++) await expect(menu.getByRole("button", { name: `标题 ${level}`, exact: true })).toBeVisible();
  await menu.getByRole("button", { name: "文字格式", exact: true }).click();
  await menu.getByRole("button", { name: "字号", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await page.locator(".menu-dropdown-list:visible").getByRole("button", { name: "24px", exact: true }).click();
  await expect(content.locator('span[style*="font-size"]')).toHaveCSS("font-size", "24px");
});

for (const [label, selector] of [
  ["加粗 (Ctrl+B)", "strong"], ["斜体 (Ctrl+I)", "em"], ["删除线 (Ctrl+Shift+X)", "s"], ["行内代码", "code"],
  ...[1, 2, 3, 4, 5, 6].map(level => [`标题 ${level}`, `h${level}`]),
  ["无序列表 (Ctrl+Shift+8)", "ul"], ["有序列表 (Ctrl+Shift+7)", "ol"],
  ["引用 (Ctrl+Shift+B)", "blockquote"], ["代码块 (Ctrl+Alt+C)", "pre"],
]) test(`选区命令实际修改正文：${label}`, async ({ page }) => {
  await createBlankDocument(page);
  const content = page.locator(".ProseMirror");
  await content.fill("first second");
  const hover = await select(page);
  await hover.getByTitle(label, { exact: true }).click();
  await expect(content.locator(selector).first()).toContainText("first");
});

test("选区菜单复制粘贴和链接图片入口可用", async ({ page }) => {
  await createBlankDocument(page);
  const content = page.locator(".ProseMirror");
  await content.fill("first second");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; },
      write: async (items: ClipboardItem[]) => { (window as unknown as { copied: string }).copied = await (await items[0].getType("text/plain")).text(); },
      readText: async () => "pasted",
    } });
  });
  let hover = await select(page);
  await hover.getByTitle("复制 (Ctrl+C)", { exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe("first");
  hover = await select(page);
  await hover.getByTitle("粘贴 (Ctrl+V)", { exact: true }).click();
  await expect(content).toContainText("pasted");
  hover = await select(page);
  await hover.getByTitle("添加或编辑链接", { exact: true }).click();
  await expect(page.locator(".image-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  hover = await select(page);
  await hover.getByTitle("插入图片", { exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("右键各分组覆盖当前宿主工具栏命令及禁用状态", async ({ page }) => {
  await createBlankDocument(page);
  const content = page.locator(".ProseMirror");
  await content.fill("first second");
  await content.locator("p").click({ button: "right" });
  const expected = await page.locator(".editor-menu button").evaluateAll(buttons => buttons.filter(button => !button.closest(".menu-dropdown-list") && !button.hasAttribute("data-command-presentation-only")).map(button => ({
    label: (button as HTMLButtonElement).title || button.getAttribute("aria-label") || button.textContent?.trim(),
    disabled: (button as HTMLButtonElement).disabled,
  })));
  const menu = page.getByRole("menu", { name: "正文操作" });
  const seen = new Map<string, boolean>();
  for (const group of ["编辑", "文字格式", "段落", "插入", "表格", "文档"]) {
    const button = menu.getByRole("button", { name: group, exact: true });
    if (!await button.count()) continue;
    await button.click();
    for (const value of await menu.getByRole("group", { name: group, exact: true }).locator("button").evaluateAll(buttons => buttons.map(button => ({ label: button.textContent!.trim(), disabled: button.disabled })))) seen.set(value.label, value.disabled);
  }
  for (const command of expected) {
    if (command.label === "全选") continue;
    expect(seen.has(command.label!), command.label).toBe(true);
    expect(seen.get(command.label!), command.label).toBe(command.disabled);
  }
});

test("按钮按下期间宿主状态刷新不吞掉点击", async ({ page }) => {
  await createBlankDocument(page);
  const content = page.locator(".ProseMirror");
  await content.fill("first second");
  const hover = await select(page);
  const button = hover.getByTitle("加粗 (Ctrl+B)", { exact: true });
  const rect = (await button.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.locator('.note-editor .editor-menu').getByTitle("加粗 (Ctrl+B)", { exact: true }).evaluate(element => element.classList.add("test-state-refresh"));
  await expect(button).toHaveClass(/test-state-refresh/);
  await page.mouse.up();
  await expect(content.locator("strong")).toHaveText("first");
});

for (const [label, node] of [["插入 3×3 表格", "table"], ["插入流程块", "codeBlock"], ["水平分隔线", "horizontalRule"], ["块内换行", "hardBreak"]])
  test(`选区插入命令：${label}`, async ({ page }) => {
    await createBlankDocument(page);
    const content = page.locator(".ProseMirror");
    await content.fill("first second");
    const hover = await select(page);
    await hover.getByTitle(label, { exact: true }).click();
    await expect.poll(() => content.evaluate(element => JSON.stringify((element as HTMLElement & { editor: Editor }).editor.getJSON()))).toContain(`"type":"${node}"`);
  });

test("选区工具的撤销重做清除格式和正文转换", async ({ page }) => {
  await createBlankDocument(page);
  const content = page.locator(".ProseMirror");
  await content.fill("first second");
  let hover = await select(page);
  await hover.getByTitle("加粗 (Ctrl+B)", { exact: true }).click();
  hover = await select(page);
  await hover.getByTitle("撤销 (Ctrl+Z)", { exact: true }).click();
  await expect(content.locator("strong")).toHaveCount(0);
  hover = await select(page);
  await hover.getByTitle("重做 (Ctrl+Y)", { exact: true }).click();
  await expect(content.locator("strong")).toHaveText("first");
  hover = await select(page);
  await hover.getByTitle("清除格式", { exact: true }).click();
  await expect(content.locator("strong")).toHaveCount(0);
  hover = await select(page);
  await hover.getByTitle("标题 3", { exact: true }).click();
  // Selection helper targets a paragraph; restore the same selected positions in the heading.
  await content.evaluate(element => { const editor = (element as HTMLElement & { editor: Editor }).editor; editor.commands.setTextSelection({ from: 1, to: 6 }); editor.view.focus(); });
  const box = (await content.locator("h3").boundingBox())!;
  await page.mouse.move(box.x + 12, box.y + box.height / 2);
  await page.getByRole("toolbar", { name: "选区编辑工具" }).getByTitle("正文", { exact: true }).click();
  await expect(content.locator("h3")).toHaveCount(0);
  await expect(content.locator("p")).toHaveText("first second");
});
