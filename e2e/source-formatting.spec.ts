import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, selectDocumentLanguage, selectSource, sourceInfo } from "./helpers/source-editor";

test("C/C++ 本地格式化全文、风格配置、选区、撤销与只读保护", async ({ page }) => {
  await createBlankDocument(page, "格式化测试");
  await selectDocumentLanguage(page, "c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  const raw = "int main(){\nint value=1;\nreturn value;\n}";
  await replaceSource(area, raw);
  await selectSource(area, raw.indexOf("return"));
  const toolbar = page.getByRole("toolbar", { name: "源码编辑工具" });
  const document = toolbar.getByRole("button", { name: "格式化全文", exact: true });
  const selection = toolbar.getByRole("button", { name: "格式化选区", exact: true });
  await expect(selection).toBeDisabled();
  await document.click();
  await expect(page.getByRole("status").filter({ hasText: "已格式化全文" })).toBeVisible();
  await expect.poll(async () => (await sourceInfo(area)).value).toContain("int value = 1;");
  await expect(area).toBeFocused();
  await toolbar.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw);
  await toolbar.getByRole("button", { name: "代码格式风格", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Microsoft", exact: true }).click();
  await page.evaluate(async () => (await import("/src/lib/native-menu-registry.ts")).runNativeMenuAction("source.formatDocument"));
  await expect.poll(async () => (await sourceInfo(area)).value).toContain("main()\n{");
  // Change the same source again, then format only one function after Unicode.
  const partial = "// 中文\nint before(){return 1;}\nint selected(){int x=1;return x;}\nint after(){return 2;}";
  await replaceSource(area, partial);
  await selectSource(area, partial.indexOf("int selected"), partial.indexOf("\nint after"));
  await selection.click();
  await expect.poll(async () => (await sourceInfo(area)).value).toContain("selected()\n{");
  expect((await sourceInfo(area)).value).toContain("int after(){return 2;}");
  await toolbar.getByRole("button", { name: "代码格式风格", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "自定义 .clang-format", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "代码格式配置", exact: true });
  await dialog.getByRole("textbox", { name: ".clang-format 配置", exact: true }).fill("UnknownNineRingsOption: true");
  await dialog.getByRole("button", { name: "使用此配置", exact: true }).click();
  const beforeError = (await sourceInfo(area)).value;
  await document.click();
  await expect(page.getByRole("status").filter({ hasText: "格式化失败" })).toBeVisible();
  expect((await sourceInfo(area)).value).toBe(beforeError);
  await page.getByRole("button", { name: "设置只读", exact: true }).click();
  await expect(document).toBeDisabled();
  await expect(selection).toBeDisabled();
});

test("导入配置可重开，长代码格式化保持当前词与阅读位置", async ({ page }) => {
  await createBlankDocument(page);
  await selectDocumentLanguage(page, "c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  const toolbar = page.getByRole("toolbar", { name: "源码编辑工具" });
  await toolbar.getByRole("button", { name: "代码格式风格", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "自定义 .clang-format", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "代码格式配置", exact: true });
  await dialog.getByLabel("导入格式配置", { exact: true }).setInputFiles({ name: ".clang-format", mimeType: "text/plain", buffer: Buffer.from("BasedOnStyle: Microsoft\nIndentWidth: 2\nUseTab: Never\n") });
  await expect(dialog.getByRole("textbox", { name: ".clang-format 配置", exact: true })).toContainText("IndentWidth: 2");
  await dialog.getByRole("button", { name: "使用此配置", exact: true }).click();
  const raw = `void example(){\n${Array.from({ length: 250 }, (_, n) => `int value${n}=${n};`).join("\n")}\n}`;
  await replaceSource(area, raw);
  const target = raw.indexOf("value150");
  await selectSource(area, target, target + "value150".length);
  await expect.poll(async () => (await sourceInfo(area)).scrollTop).toBeGreaterThan(200);
  const before = await area.evaluate(element => {
    const view = (window as unknown as { sourceCM: typeof import("@codemirror/view") }).sourceCM.EditorView.findFromDOM(element)!;
    return view.state.doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.scrollTop).from).text.trim();
  });
  await toolbar.getByRole("button", { name: "格式化全文", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已格式化全文" })).toBeVisible();
  const after = await sourceInfo(area);
  expect(after.value.slice(after.selectionStart, after.selectionEnd)).toBe("value150");
  const top = await area.evaluate(element => {
    const view = (window as unknown as { sourceCM: typeof import("@codemirror/view") }).sourceCM.EditorView.findFromDOM(element)!;
    return view.state.doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.scrollTop).from).text.trim();
  });
  expect(top.replace(/\s/g, "")).toBe(before.replace(/\s/g, ""));
  await expect.poll(() => page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const note = await api.notes.get(localStorage.getItem("nr:lastNote")!);
    return note?.content?.metadata?.sourceLanguage;
  })).toBe("c");
  await page.reload();
  await expect(toolbar.getByRole("button", { name: "代码格式风格", exact: true })).toContainText("自定义");
});

test("格式化期间继续输入会丢弃旧结果", async ({ page }) => {
  await createBlankDocument(page);
  await selectDocumentLanguage(page, "c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  await replaceSource(area, "int main(){return 0;}");
  await page.route(/source-format\.worker/, async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.getByRole("button", { name: "格式化全文", exact: true }).click();
  await area.press("End");
  await page.keyboard.type(" // new text");
  const edited = (await sourceInfo(area)).value;
  await expect(page.getByRole("status").filter({ hasText: "已丢弃格式化结果" })).toBeVisible();
  expect((await sourceInfo(area)).value).toBe(edited);
});
