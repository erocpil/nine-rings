import { expect, test } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";
import { replaceSource, sourceInfo, selectSource, selectDocumentLanguage } from "./helpers/source-editor";

test("状态栏文件格式与系统菜单共享设置，切换语法保留正文、选区与历史", async ({ page }) => {
  await createBlankDocument(page, "文件格式");
  await page.locator(".ProseMirror").fill("文件格式测试");
  await waitForSavedText(page, "文件格式测试");
  const persisted = () => page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    return (await api.notes.get(localStorage.getItem("nr:lastNote")!))!.content;
  });
  const before = await persisted();
  const format = page.locator(".editor-status-bar").getByRole("button", { name: "文件格式", exact: true });
  await expect(format).toHaveCount(0);
  await page.evaluate(async () => {
    const menu = await import("/src/lib/native-menu-registry.ts");
    await menu.runNativeMenuAction("format.language.python");
  });
  await expect(format).toContainText("Python");
  await expect.poll(async () => (await persisted()).metadata?.sourceLanguage).toBe("python");
  expect((await persisted()).ops).toEqual(before.ops);
  await expect(page.getByRole("button", { name: "源码", exact: true })).toHaveCount(0);
  await expect(page.locator(".cm-content")).toBeVisible();
  const area = page.locator(".cm-content");
  await replaceSource(area, 'def greet(name):\n    return "Hello " + name\n');
  await expect(area.locator("span").filter({ hasText: /^def$/ })).toBeVisible();
  await selectSource(area, 4, 9);
  const sourceBefore = await sourceInfo(area);
  await selectDocumentLanguage(page, "");
  await expect(area.locator("span").filter({ hasText: /^def$/ })).toHaveCount(0);
  const sourceAfter = await sourceInfo(area);
  expect(sourceAfter.value).toBe(sourceBefore.value);
  expect(sourceAfter.selectionStart).toBe(sourceBefore.selectionStart);
  expect(sourceAfter.selectionEnd).toBe(sourceBefore.selectionEnd);
  await page.evaluate(async () => {
    const menu = await import("/src/lib/native-menu-registry.ts");
    await menu.runNativeMenuAction("format.language.python");
  });
  await expect(format).toContainText("Python");
  await expect(area.locator("span").filter({ hasText: /^def$/ })).toBeVisible();
  await expect.poll(async () => (await persisted()).metadata?.sourceLanguage).toBe("python");
  await page.evaluate(async () => {
    const menu = await import("/src/lib/native-menu-registry.ts");
    await menu.runNativeMenuAction("edit.undo");
  });
  await expect(area).toContainText("文件格式测试");
  await expect.poll(() => page.evaluate(async () => {
    const menu = await import("/src/lib/native-menu-registry.ts");
    return menu.nativeMenuSnapshot().find(item => item.id === "edit.redo")?.enabled;
  })).toBe(true);
  await page.evaluate(async () => {
    const menu = await import("/src/lib/native-menu-registry.ts");
    await menu.runNativeMenuAction("edit.redo");
  });
  await expect(area).toContainText("def greet(name)");
  await expect.poll(async () => (await persisted()).metadata?.sourceText).toContain("def greet(name)");
  await page.reload();
  await expect(format).toContainText("Python");
  await expect(page.locator(".cm-content")).toContainText("def greet(name)");
});

test("文件格式在只读时显示但不可更改，系统菜单同时禁用", async ({ page }) => {
  await createBlankDocument(page, "只读格式");
  await expect(page.locator(".editor-status-bar").getByRole("button", { name: "文件格式", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(page.getByRole("button", { name: "点击设为可编辑", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const menu = await import("/src/lib/native-menu-registry.ts");
    return menu.nativeMenuSnapshot().find(item => item.id === "format.language.python")?.enabled;
  })).toBe(false);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  const format = page.locator(".editor-status-bar").getByRole("button", { name: "文件格式", exact: true });
  if (await format.count()) await expect(format).toBeDisabled();
});

test("标题右侧源码、插件、目录与书签按钮等宽", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nr:pluginsEnabled", "true");
    localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "calm" }));
  });
  await createBlankDocument(page, "标题按钮尺寸");
  await page.locator(".ProseMirror").evaluate(element => (element as any).editor.commands.setContent({
    type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "标题" }] }],
  }, true));
  const row = page.locator(".note-title-row");
  await expect(row.getByRole("button", { name: "文档目录", exact: true })).toBeVisible();
  for (const width of [1280, 390, 350]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(async () => {
      const widths = await row.locator('button[aria-label="源码"], button[aria-label="文档目录"], button[aria-label="文档书签"], button[aria-label="书签与标注"], button[aria-label="内置插件"]').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
      return widths.length === 4 && Math.min(...widths) > 0 ? Math.max(...widths) - Math.min(...widths) : Infinity;
    }).toBeLessThan(1);
  }
});
