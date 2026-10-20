import { expect, test, type Locator, type Page } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, selectDocumentLanguage, selectSource, sourceInfo } from "./helpers/source-editor";

async function openLine(page: Page, area: Locator, number: number) {
  await sourceInfo(area);
  const point = await area.evaluate((element, lineNumber) => {
    const view = (window as any).sourceCM.EditorView.findFromDOM(element);
    const rect = view.coordsAtPos(view.state.doc.line(lineNumber).from);
    const gutter = view.dom.querySelector(".cm-lineNumbers").getBoundingClientRect();
    return { x: gutter.left + gutter.width / 2, y: (rect.top + rect.bottom) / 2 };
  }, number);
  await page.mouse.click(point.x, point.y);
  const menu = page.getByRole("menu", { name: "源码行菜单", exact: true });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText(`第 ${number} 行`);
  return menu;
}

test("源码行号菜单操作实际行并保留换行、撤销与只读边界", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true }));
    (window as any).sourceClipboard = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { (window as any).sourceClipboard = text; },
      readText: async () => (window as any).sourceClipboard,
    } });
  });
  await createBlankDocument(page, "源码行菜单");
  await selectDocumentLanguage(page, "c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  const original = "first\nsecond\nthird";
  await replaceSource(area, original);
  let menu = await openLine(page, area, 2);
  await menu.getByRole("menuitem", { name: "复制行", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).sourceClipboard)).toBe("second\n");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(original);
  await page.evaluate(() => { (window as any).sourceClipboard = "x\r\ny"; });
  menu = await openLine(page, area, 2);
  await menu.getByRole("menuitem", { name: "在本行前粘贴", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("first\nx\ny\nsecond\nthird");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(original);
  menu = await openLine(page, area, 3);
  await menu.getByRole("menuitem", { name: "在本行后粘贴", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("first\nsecond\nthird\nx\ny");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(original);
  menu = await openLine(page, area, 2);
  await menu.getByRole("menuitem", { name: "复制到下一行", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("first\nsecond\nsecond\nthird");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(original);
  await page.evaluate(async () => {
    const path = "/src/lib/block-display-settings.ts";
    const { saveBlockWorkspacePreferences } = await import(/* @vite-ignore */ path);
    saveBlockWorkspacePreferences({ relativeSourceLineNumbers: true });
  });
  await selectSource(area, 0);
  menu = await openLine(page, area, 3);
  await menu.getByRole("menuitem", { name: "删除行", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("first\nsecond");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(original);
  await page.evaluate(() => { (window as any).sourceClipboard = ""; });
  menu = await openLine(page, area, 2);
  await menu.getByRole("menuitem", { name: "在本行后粘贴", exact: true }).click();
  await expect(menu.getByRole("status")).toContainText("没有可粘贴的文本");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(original);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  // Permission prompts may resolve after an edit; never paste into stale text.
  await page.evaluate(() => {
    navigator.clipboard.readText = () => new Promise(resolve => { (window as any).resolveSourceClipboard = resolve; });
  });
  menu = await openLine(page, area, 2);
  await menu.getByRole("menuitem", { name: "在本行后粘贴", exact: true }).click();
  await expect(menu.getByRole("menuitem", { name: "在本行后粘贴", exact: true })).toBeDisabled();
  await replaceSource(area, original + " changed");
  await page.evaluate(() => { (window as any).resolveSourceClipboard("stale paste"); });
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(original + " changed");
  await expect(menu.getByRole("status")).toContainText("文档或编辑状态已变化");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "设置只读", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).readonly).toBe(true);
  menu = await openLine(page, area, 2);
  await expect(menu.getByRole("menuitem", { name: "删除行", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "剪切行", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "在本行后粘贴", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "复制行", exact: true })).toBeEnabled();
});

test("只读源码的文字选区在右键菜单打开期间保持高亮", async ({ page }) => {
  await createBlankDocument(page, "只读源码选区右键");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  const text = "selected source text remains visible";
  await replaceSource(area, text);
  await page.getByRole("button", { name: "设置只读", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).readonly).toBe(true);
  const line = area.locator(".cm-line").first();
  await line.selectText();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe(text);
  await line.click({ button: "right", position: { x: 24, y: 8 } });
  const menu = page.getByRole("menu", { name: "源码编辑菜单", exact: true });
  await expect(menu).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe(text);
  const selectionLayer = page.locator(".markdown-source-editor.has-source-context-menu .cm-selectionLayer");
  await expect(selectionLayer).toHaveCSS("visibility", "visible");
  const paintedSelection = await selectionLayer.locator(".cm-selectionBackground").evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  expect(paintedSelection).toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe(text);
});
