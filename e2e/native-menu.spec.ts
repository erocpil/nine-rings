import { expect, test, type Page } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";
const run = (page: Page, id: string) => page.evaluate(async id => {
  const menu = await import("/src/lib/native-menu-registry.ts");
  await menu.runNativeMenuAction(id);
}, id);
const state = (page: Page, id: string) => page.evaluate(async id => (await import("/src/lib/native-menu-registry.ts")).nativeMenuSnapshot().find(item => item.id === id), id);

test("原生菜单复用活动文档编辑、源码切换及只读保护", async ({ page }) => {
  await createBlankDocument(page, "菜单命令");
  const editor = page.locator(".note-editor .ProseMirror").first();
  await editor.fill("菜单测试正文");
  await editor.evaluate(element => {
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setTextSelection({ from: 1, to: 3 });
  });
  await run(page, "format.bold");
  await expect(editor.locator("strong")).toHaveText("菜单");
  await expect.poll(() => state(page, "format.bold")).toMatchObject({ checked: true, enabled: true });
  await waitForSavedText(page, "菜单测试正文");
  await run(page, "document.source");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect.poll(() => state(page, "document.source")).toMatchObject({ checked: true });
  await expect.poll(() => state(page, "format.bold")).toMatchObject({ enabled: true });
  await run(page, "document.find");
  await expect(page.locator(".cm-search")).toBeVisible();
  await run(page, "document.find");
  await expect(page.locator(".cm-search")).toHaveCount(0);
  await run(page, "document.readonly");
  await expect.poll(() => state(page, "document.replace")).toMatchObject({ enabled: false });
  await run(page, "document.source");
  await expect(editor).toBeVisible();
  await expect.poll(() => state(page, "format.bold")).toMatchObject({ enabled: false });
  await run(page, "format.bold");
  await expect(editor.locator("strong")).toHaveText("菜单");
});

test("菜单设置弹层阻止背景命令，风格配色与专注状态同步", async ({ page }) => {
  await createBlankDocument(page, "菜单状态");
  await run(page, "style.paper");
  await expect(page.locator("html")).toHaveAttribute("data-interface-style", "paper");
  await expect.poll(() => state(page, "style.paper")).toMatchObject({ checked: true });
  await run(page, "color.dark");
  await expect(page.locator("html")).toHaveClass(/theme-dark/);
  await run(page, "view.focus");
  await expect.poll(() => state(page, "view.focus")).toMatchObject({ checked: true });
  await run(page, "workspace.settings");
  await expect(page.getByRole("button", { name: "关闭设置", exact: true })).toBeVisible();
  await expect.poll(() => state(page, "view.focus")).toMatchObject({ enabled: false });
  await run(page, "view.focus");
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.settings-panel')))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "关闭设置", exact: true })).toBeHidden();
  await expect.poll(() => state(page, "view.focus")).toMatchObject({ checked: true, enabled: true });
});


test("隐藏的源码文档不会接收当前文档的菜单命令", async ({ page }) => {
  await createBlankDocument(page, "保留源码实例");
  await page.locator(".ProseMirror:visible").fill("第一份文档");
  await run(page, "document.source");
  await expect(page.locator(".cm-editor:visible")).toBeVisible();
  await run(page, "workspace.new");
  await page.getByPlaceholder("文档标题...").fill("当前渲染文档");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator("input.note-title:visible")).toHaveValue("当前渲染文档");
  await expect(page.locator(".ProseMirror:visible")).toBeEditable();
  await expect.poll(() => state(page, "document.source")).toMatchObject({ checked: false });
  await expect.poll(() => state(page, "document.find")).toMatchObject({ enabled: true });
  await run(page, "document.find");
  await expect(page.getByRole("textbox", { name: "在当前文档中查找", exact: true })).toBeVisible();
  await expect(page.locator(".cm-search")).toHaveCount(0);
  await expect.poll(() => state(page, "document.source")).toMatchObject({ checked: false });
});

test("源码格式勾选跟随光标与混合选区，快捷键修改可撤销", async ({ page }) => {
  await createBlankDocument(page, "源码格式状态");
  await run(page, "document.source");
  const { replaceSource, selectSource, sourceInfo } = await import("./helpers/source-editor");
  const area = page.locator(".cm-content:visible");
  const sourceText = async () => (await sourceInfo(area)).value;
  const selectText = async (text: string) => { const value = await sourceText(); const from = value.indexOf(text); expect(from).toBeGreaterThanOrEqual(0); await selectSource(area, from, from + text.length); };
  await replaceSource(area, "**strong** plain\n\n`literal`\n\n### Heading");
  await selectText("strong");
  await expect.poll(() => state(page, "format.bold")).toMatchObject({ checked: true });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+b" : "Control+b");
  await expect.poll(() => sourceText()).toContain("strong plain");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(() => sourceText()).toContain("**strong** plain");
  await selectText("strong** plain");
  await expect.poll(() => state(page, "format.bold")).toMatchObject({ checked: false });
  await selectText("literal");
  await expect.poll(() => state(page, "format.code")).toMatchObject({ checked: true });
  await expect.poll(() => state(page, "format.bold")).toMatchObject({ enabled: false });
  await selectText("Heading");
  await expect.poll(() => state(page, "format.h3")).toMatchObject({ checked: true });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Alt+4" : "Control+Alt+4");
  await expect.poll(() => sourceText()).toContain("#### Heading");
  await expect.poll(() => state(page, "format.h4")).toMatchObject({ checked: true });
});

test("专注模式源码更多工具和渲染模式共享展开状态", async ({ page }) => {
  await createBlankDocument(page, "源码专注工具");
  await run(page, "view.focus");
  await run(page, "document.source");
  const toolbar = page.locator(".markdown-source-toolbar-host");
  const tools = page.getByRole("button", { name: "更多编辑工具", exact: true });
  await expect(tools).toBeVisible();
  await expect(toolbar).toBeHidden();
  await tools.click();
  await expect(toolbar).toBeVisible();
  await run(page, "document.source");
  await expect(page.locator(".editor-menu:visible")).toBeVisible();
  await run(page, "document.source");
  await expect(toolbar).toBeVisible();
  await tools.click();
  await expect(toolbar).toBeHidden();
  await run(page, "view.tools");
  await expect(toolbar).toBeVisible();
});

test("渲染快捷键只执行一次，源码快捷键保留跳转面板切换与只读保护", async ({ page }) => {
  await createBlankDocument(page, "共享快捷键");
  const primary = process.platform === "darwin" ? "Meta" : "Control";
  const editor = page.locator(".ProseMirror:visible");
  await editor.fill("Shared formatting");
  await editor.evaluate(element => (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.commands.setTextSelection({ from: 1, to: 7 }));
  await page.keyboard.press(`${primary}+b`);
  await expect(editor.locator("strong")).toHaveText("Shared");
  await page.keyboard.press(`${primary}+e`);
  await expect(editor.locator("code")).toHaveText("Shared");
  await run(page, "document.source");
  await page.locator(".cm-content:visible").click();
  await page.keyboard.press(`${primary}+g`);
  await expect(page.locator(".cm-goto-line")).toBeVisible();
  await page.keyboard.press(`${primary}+g`);
  await expect(page.locator(".cm-goto-line")).toHaveCount(0);
  await run(page, "document.readonly");
  await expect.poll(() => state(page, "format.h2")).toMatchObject({ enabled: false });
});
