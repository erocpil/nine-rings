import { expect, test, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

async function setCodeVim(page: Page, enabled: boolean) {
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
  await page.getByRole("button", { name: /打开 Vim 设置/ }).click();
  await expect(page.locator("#settings-dialog-title")).toHaveText("代码块 Vim");
  const toggle = page.getByRole("checkbox", { name: "代码块 Vim 模式（实验性）", exact: true });
  await toggle.setChecked(enabled);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("nine_rings_config") ?? "{}").editor_vim_mode)).toBe(enabled);
  await page.locator(".settings-close").click();
}

async function fixture(page: Page) {
  await createBlankDocument(page);
  const editor = page.locator(".note-editor .ProseMirror");
  await editor.evaluate(element => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    instance.commands.setContent({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "正文" }] },
      { type: "codeBlock", content: [{ type: "text", text: "alpha" }] },
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "引用" }] }] },
    ] }, true);
  });
  return editor;
}

test("代码块 Vim 开启后正文直接输入和粘贴，引用弹层保持普通编辑", async ({ page }) => {
  const editor = await fixture(page);
  await setCodeVim(page, true);
  await expect(page.locator(".editor-vim-status")).toHaveCount(0);
  await editor.evaluate(element => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    instance.commands.setTextSelection(1);
    instance.view.focus();
  });
  await page.keyboard.type("ihjkl");
  await page.keyboard.press("Escape");
  await page.keyboard.type("a");
  await editor.evaluate(element => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "粘贴");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await expect(editor.locator(":scope > p").first()).toHaveText("ihjkla粘贴正文");
  await page.getByRole("button", { name: "放大阅读引用块" }).click();
  const dialog = page.getByRole("dialog", { name: "引用块工作区" });
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(dialog.locator(".block-workspace-vim-mode")).toHaveCount(0);
  const quote = dialog.locator(".ProseMirror");
  await quote.evaluate(element => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    instance.commands.setTextSelection(2);
    instance.view.focus();
  });
  await page.keyboard.type("iahjkl");
  await expect(quote.locator(".blockquote-content p")).toHaveText("iahjkl引用");
  await dialog.getByRole("button", { name: "关闭块工作区" }).click();
  await expect(editor.locator("blockquote")).toContainText("iahjkl引用");
});

test("Vim 开关只控制代码块弹层并持久保存，关闭后仍可缩进、撤销和退出", async ({ page }) => {
  const editor = await fixture(page);
  const open = async () => {
    await page.getByRole("button", { name: "放大阅读代码块" }).click();
    const dialog = page.getByRole("dialog", { name: "代码块工作区" });
    await dialog.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(dialog.locator(".cm-content")).toBeFocused();
    return dialog;
  };
  let dialog = await open();
  await expect(dialog.locator(".block-workspace-vim-mode")).toHaveCount(0);
  await expect(dialog.getByLabel("代码块编辑器", { exact: true })).toBeVisible();
  await page.keyboard.type("i");
  await expect(editor.locator("pre code")).toHaveText("ialpha");
  await page.keyboard.press("Control+z");
  await expect(editor.locator("pre code")).toHaveText("alpha");
  await page.keyboard.press("Control+Shift+z");
  await expect(editor.locator("pre code")).toHaveText("ialpha");
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  await expect(editor.locator("pre code")).toHaveText("\tialpha");
  await page.keyboard.press("Shift+Tab");
  await expect(editor.locator("pre code")).toHaveText("ialpha");
  await page.keyboard.press("Control+Enter");
  await expect(dialog).toHaveCount(0);
  await expect(editor).toBeFocused();

  await setCodeVim(page, true);
  dialog = await open();
  await expect(dialog.locator(".block-workspace-vim-mode")).toHaveText("VIM NORMAL");
  await page.keyboard.press("i");
  await expect(dialog.locator(".block-workspace-vim-mode")).toHaveText("VIM INSERT");
  await page.keyboard.type("enabled");
  await expect(editor.locator("pre code")).toHaveText("enabledialpha");
  await page.keyboard.press("Escape");
  await expect(dialog.locator(".block-workspace-vim-mode")).toHaveText("VIM NORMAL");
  await dialog.getByRole("button", { name: "关闭块工作区" }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(editor.locator("pre code")).toHaveText("enabledialpha");
  dialog = await open();
  await expect(dialog.locator(".block-workspace-vim-mode")).toHaveText("VIM NORMAL");
  await dialog.getByRole("button", { name: "关闭块工作区" }).click();
  await setCodeVim(page, false);
  dialog = await open();
  await expect(dialog.locator(".block-workspace-vim-mode")).toHaveCount(0);
  await page.keyboard.type("disabled");
  await expect(editor.locator("pre code")).toHaveText("disabledenabledialpha");
});
