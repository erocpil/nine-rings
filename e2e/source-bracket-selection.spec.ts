import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, selectDocumentLanguage, selectSource, sourceInfo } from "./helpers/source-editor";

test("源码双击匹配括号时选中括号之间的内容", async ({ page }) => {
  await createBlankDocument(page, "源码括号选区");
  await selectDocumentLanguage(page, "c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  await expect(area).toBeVisible();
  const source = "int main() {\n  call(first, nested(second));\n  return 0;\n}\n";
  await replaceSource(area, source);

  const doubleClickAt = async (offset: number) => {
    const point = await area.evaluate((element, position) => {
      const { EditorView } = (window as unknown as { sourceCM: typeof import("@codemirror/view") }).sourceCM;
      const view = EditorView.findFromDOM(element)!;
      const before = view.coordsAtPos(position)!;
      const after = view.coordsAtPos(position + 1)!;
      return { x: (before.left + after.left) / 2, y: (before.top + before.bottom) / 2 };
    }, offset);
    await page.mouse.dblclick(point.x, point.y);
  };

  const openParen = source.indexOf("(", source.indexOf("nested"));
  const closeParen = source.indexOf(")", openParen);
  await doubleClickAt(openParen);
  await expect.poll(async () => {
    const state = await sourceInfo(area);
    return [state.selectionStart, state.selectionEnd];
  }).toEqual([openParen + 1, closeParen]);

  await doubleClickAt(openParen + 1);
  await expect.poll(async () => {
    const state = await sourceInfo(area);
    return source.slice(state.selectionStart, state.selectionEnd);
  }).toBe("second");

  const openBrace = source.indexOf("{");
  const closeBrace = source.lastIndexOf("}");
  await doubleClickAt(closeBrace);
  await expect.poll(async () => {
    const state = await sourceInfo(area);
    return [state.selectionStart, state.selectionEnd];
  }).toEqual([openBrace + 1, closeBrace]);
});

test("代码文档选中文本后仍可打开查找替换和跳转行", async ({ page }) => {
  await createBlankDocument(page, "源码查找跳转");
  await selectDocumentLanguage(page, "c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  await expect(area).toBeVisible();
  const value = "int main() {\n  return answer;\n}\n";
  await replaceSource(area, value);
  const toolbar = page.getByRole("toolbar", { name: "选区编辑工具", exact: true });
  const hoverSelection = async (offset: number) => {
    const point = await area.evaluate((element, offset) => {
      const { EditorView } = (window as unknown as { sourceCM: typeof import("@codemirror/view") }).sourceCM;
      const rect = EditorView.findFromDOM(element)!.coordsAtPos(offset)!;
      return { x: rect.left, y: (rect.top + rect.bottom) / 2 };
    }, offset);
    await page.mouse.move(point.x, point.y);
    await expect(toolbar).toBeVisible();
  };

  const answer = value.indexOf("answer");
  const selectionPoints = await area.evaluate((element, range) => {
    const { EditorView } = (window as unknown as { sourceCM: typeof import("@codemirror/view") }).sourceCM;
    const view = EditorView.findFromDOM(element)!;
    const from = view.coordsAtPos(range.from)!;
    const to = view.coordsAtPos(range.to)!;
    return { from: { x: from.left + 1, y: (from.top + from.bottom) / 2 }, to: { x: to.left, y: (to.top + to.bottom) / 2 } };
  }, { from: answer, to: answer + "answer".length });
  await page.mouse.move(selectionPoints.from.x, selectionPoints.from.y);
  await page.mouse.down();
  await page.mouse.move(selectionPoints.to.x, selectionPoints.to.y);
  await page.mouse.up();
  await expect.poll(async () => {
    const state = await sourceInfo(area);
    return value.slice(state.selectionStart, state.selectionEnd);
  }).toBe("answer");
  await hoverSelection(answer + 3);
  await toolbar.getByRole("button", { name: "查找替换", exact: true }).click();
  const search = page.getByRole("search", { name: "源码查找与替换" });
  await expect(search).toBeVisible();
  await expect(search.getByRole("textbox", { name: "查找", exact: true })).toHaveValue("answer");
  await search.getByRole("textbox", { name: "查找", exact: true }).fill("return");
  await expect(search).toBeVisible();
  await search.getByRole("button", { name: "关闭", exact: true }).click();

  const returned = value.indexOf("return");
  await selectSource(area, returned, returned + "return".length);
  await hoverSelection(returned + 3);
  await toolbar.getByRole("button", { name: "跳转行", exact: true }).click();
  const jump = page.getByRole("form", { name: "源码跳转行" });
  await expect(jump).toBeVisible();
  await expect(jump.getByRole("textbox", { name: "行号或位置" })).toHaveValue("2");
});
