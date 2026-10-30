import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, selectDocumentLanguage, selectSource, sourceInfo } from "./helpers/source-editor";

for (const readonly of [false, true]) test(`源码折叠展开恢复行列，主动移动光标优先 readonly=${readonly}`, async ({ page }) => {
  await createBlankDocument(page, "源码折叠位置");
  await selectDocumentLanguage(page, "c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  const text = "int main() {\n  first();\n  second();\n  return 0;\n}\n// outside\n" + "// padding\n".repeat(100);
  await replaceSource(area, text);
  if (readonly) {
    await page.getByRole("button", { name: "设置只读", exact: true }).click();
    await expect(area).not.toBeEditable();
  }
  const offset = text.indexOf("second") + 3;
  await selectSource(area, offset);
  const point = await area.evaluate((element, offset) => {
    const { EditorView } = (window as any).sourceCM;
    const rect = EditorView.findFromDOM(element)!.coordsAtPos(offset)!;
    return { x: rect.left + 1, y: (rect.top + rect.bottom) / 2 };
  }, offset);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(offset);
  const gutter = area.locator("..").locator(".cm-foldGutter .cm-gutterElement:visible").filter({ has: page.locator("span") }).first();
  await gutter.click();
  await expect(area.locator(".cm-foldPlaceholder")).toHaveCount(1);
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(text.indexOf("{") + 1);
  const scroller = area.locator("..");
  await scroller.hover();
  await page.mouse.wheel(0, 900);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(200);
  await page.mouse.wheel(0, -3000);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThan(2);
  await area.locator(".cm-foldPlaceholder").click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(offset);
  await expect(area.locator(".cm-foldPlaceholder")).toHaveCount(0);
  await gutter.click();
  const outside = text.indexOf("outside") + 2;
  await selectSource(area, outside);
  await gutter.click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(outside);
  // Toolbar operations follow the same rule as gutter and placeholder clicks.
  await selectSource(area, offset);
  const toolbar = page.getByRole("toolbar", { name: "源码编辑工具", exact: true });
  await toolbar.getByRole("button", { name: "折叠全部", exact: true }).click();
  await toolbar.getByRole("button", { name: "展开全部", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(offset);
  expect((await sourceInfo(area)).value).toBe(text);
});

test("Markdown 标题折叠使用相同的光标恢复规则", async ({ page }) => {
  await createBlankDocument(page, "标题折叠光标");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  const text = "# One\n\nparagraph\nmore text\n\n# Two\n\nother\n";
  await replaceSource(area, text);
  const offset = text.indexOf("more") + 2;
  await selectSource(area, offset);
  await area.locator("..").locator(".cm-foldGutter .cm-gutterElement:visible").filter({ has: page.locator("span") }).first().click();
  await expect(area.locator(".cm-foldPlaceholder")).toHaveCount(1);
  await area.locator(".cm-foldPlaceholder").click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(offset);
  const toolbar = page.getByRole("toolbar", { name: "源码编辑工具", exact: true });
  await toolbar.getByRole("button", { name: "折叠全部", exact: true }).click();
  await toolbar.getByRole("button", { name: "展开全部", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(offset);
});

test("折叠可视区上方的函数时保持下方 main 函数在视口中的位置", async ({ page }) => {
  await createBlankDocument(page, "上方函数折叠保持视口");
  await selectDocumentLanguage(page, "c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  const text = [
    "static void rearrange(void) {",
    ...Array.from({ length: 62 }, (_, index) => `  work_${index}();`),
    "}",
    "",
    "int main(void) {",
    "  return 0;",
    "}",
  ].join("\n");
  await replaceSource(area, text);
  const mainLine = text.split("\n").findIndex(line => line.startsWith("int main")) + 1;
  await selectSource(area, text.indexOf("int main"));
  await area.evaluate((content, line) => {
    const { EditorView } = (window as any).sourceCM;
    const view = EditorView.findFromDOM(content as HTMLElement)!;
    view.scrollDOM.scrollTop = Math.max(0, view.lineBlockAt(view.state.doc.line(line).from).top - view.defaultLineHeight * 2);
  }, mainLine);
  await expect.poll(() => area.evaluate((content, line) => {
    const view = (window as any).sourceCM.EditorView.findFromDOM(content as HTMLElement)!;
    const bounds = view.scrollDOM.getBoundingClientRect();
    const top = view.coordsAtPos(view.state.doc.line(line).from)!.top;
    return top > bounds.top && top < bounds.bottom;
  }, mainLine)).toBe(true);
  const main = area;
  const scroller = area.locator("..");
  const mainTopBefore = await main.evaluate((content, line) => {
    const view = (window as any).sourceCM.EditorView.findFromDOM(content as HTMLElement)!;
    const position = view.state.doc.line(line as number).from;
    return view.coordsAtPos(position)!.top;
  }, mainLine);
  expect(mainTopBefore).toBeGreaterThan(0);
  expect(mainTopBefore).toBeLessThan(page.viewportSize()!.height);
  const fold = area.locator("..")
    .locator(".cm-foldGutter .cm-gutterElement:visible")
    .filter({ has: page.locator("span[data-fold-end=true]") })
    .first();
  await fold.click();
  await expect.poll(() => main.evaluate((content, line) => {
    const view = (window as any).sourceCM.EditorView.findFromDOM(content as HTMLElement)!;
    return Math.abs(view.coordsAtPos(view.state.doc.line(line.number).from)!.top - line.top);
  }, { number: mainLine, top: mainTopBefore })).toBeLessThan(3);
  const mainTopAfter = await main.evaluate((content, line) => {
    const view = (window as any).sourceCM.EditorView.findFromDOM(content as HTMLElement)!;
    const position = view.state.doc.line(line as number).from;
    return view.coordsAtPos(position)!.top;
  }, mainLine);
  expect(Math.abs(mainTopAfter - mainTopBefore)).toBeLessThan(3);
  await expect(scroller.locator(".cm-foldPlaceholder")).toBeVisible();
});
