import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { selectSource, replaceSource, sourceInfo } from "./helpers/source-editor";

test("表格行列选择、合并拆分与背景色保存重载及源码往返", async ({ page }) => {
  await createBlankDocument(page);
  const editor = page.locator(".ProseMirror");
  await page.getByTitle("插入 3×3 表格", { exact: true }).click();
  const cells = editor.locator("th,td");
  await cells.nth(3).click();
  await page.getByTitle("选择当前行", { exact: true }).click();
  await expect(editor.locator(".selectedCell")).toHaveCount(3);
  await page.getByTitle("表格操作", { exact: true }).click();
  await page.getByRole("button", { name: "合并所选单元格", exact: true }).click();
  await expect(editor.locator('td[colspan="3"]')).toHaveCount(1);
  await page.getByRole("button", { name: "单元格背景色", exact: true }).click();
  await page.getByRole("button", { name: "背景色 #d6a348", exact: true }).click();
  await expect(editor.locator('td[colspan="3"]')).toHaveAttribute("data-background-color", "#d6a348");
  await expect.poll(() => page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const note = await api.notes.get(localStorage.getItem("nr:lastNote")!);
    return JSON.stringify(note?.content);
  })).toContain('"colspan":3');
  await page.reload();
  await expect(editor.locator('td[colspan="3"]')).toHaveAttribute("data-background-color", "#d6a348");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await expect(source).toContainText('colspan="3"');
  // Make a real source edit so the parser, rather than unchanged-source reuse, is exercised.
  const info = await sourceInfo(source);
  await replaceSource(source, info.value + "\n\n尾部");
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(editor.locator('td[colspan="3"]')).toHaveAttribute("data-background-color", "#d6a348");
  await editor.locator('td[colspan="3"]').click();
  await page.getByTitle("表格操作", { exact: true }).click();
  await page.getByRole("button", { name: "拆分单元格", exact: true }).click();
  await expect(editor.locator("th,td")).toHaveCount(9);
  await editor.locator("td").first().click();
  await page.getByTitle("选择当前列", { exact: true }).click();
  await expect(editor.locator(".selectedCell")).toHaveCount(3);
});

test("悬停选区展示全部宿主工具，移走收回，文字背景可撤销", async ({ page }) => {
  await createBlankDocument(page);
  const editor = page.locator(".ProseMirror");
  await editor.fill("selected content");
  await editor.evaluate(element => {
    const instance = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    instance.commands.setTextSelection({from:1,to:9}); instance.view.focus();
  });
  const rect = (await editor.locator("p").boundingBox())!;
  await page.mouse.move(rect.x + 20, rect.y + rect.height / 2);
  const hover = page.getByRole("toolbar", { name: "选区编辑工具", exact: true });
  await expect(hover).toBeVisible();
  await hover.getByRole("button", { name: "加粗 (Ctrl+B)", exact: true }).click();
  await expect(editor.locator("strong")).toHaveText("selected");
  await page.mouse.move(1,1);
  await expect(hover).toHaveCount(0);
  await page.getByRole("button", { name: "文字背景色", exact: true }).click();
  await page.getByRole("button", { name: "背景色 #83a66e", exact: true }).click();
  await expect(editor.locator("mark")).toHaveAttribute("data-background-color", "#83a66e");
  await editor.press("ControlOrMeta+z");
  await expect(editor.locator("mark")).toHaveCount(0);
});

test("源码选区悬停复用源码工具，格式命令保留选择", async ({ page }) => {
  await createBlankDocument(page);
  await page.getByRole("button", {name:"源码",exact:true}).click();
  const source = page.getByRole("textbox", {name:"Markdown 源码",exact:true});
  await replaceSource(source,"selected content"); await source.focus(); await selectSource(source,0,8);
  const rect = (await source.locator(".cm-line").boundingBox())!;
  await page.mouse.move(rect.x+20,rect.y+rect.height/2);
  const hover = page.getByRole("toolbar",{name:"选区编辑工具",exact:true});
  await expect(hover).toBeVisible();
  await hover.getByRole("button",{name:"加粗",exact:true}).click();
  await expect(source).toContainText("**selected** content");
});
