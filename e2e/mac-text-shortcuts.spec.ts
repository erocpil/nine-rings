import { expect, test, type Locator, type Page } from "@playwright/test";
import { createPdfFixture } from "./helpers/reader-fixtures";

async function fixture(page: Page, platform = "MacIntel") {
  await page.addInitScript((platform) => {
    Object.defineProperty(navigator, "platform", { value: platform });
  }, platform);
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { mdToDelta } = await load("/src/lib/md-parser.ts");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
    const note = await api.notes.create({
      title: "Mac 文本编辑",
      storagePath: "tests",
      content: mdToDelta(
        "第一行 alpha\n\n第二行 beta\n\n```text\ncode text\n```\n\n" +
          "后续段落用于验证 Vim 翻页。\n\n".repeat(40),
      ),
    });
    useNotesStore.getState().selectNote(note);
  });
  await expect(
    page.getByRole("textbox", { name: "文档标题", exact: true }),
  ).toHaveValue("Mac 文本编辑");
  return page.locator(".note-editor .ProseMirror");
}

// Linux browser runners cannot perform Cocoa's default text actions. Check
// that the complete DOM propagation path leaves those actions available.
async function nativeControlAllowed(target: Locator, key: string) {
  return target.evaluate(
    (element, key) =>
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          code: `Key${key.toUpperCase()}`,
          keyCode: key.toUpperCase().charCodeAt(0),
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    key,
  );
}

test("Mac 标题和源码保留原生 Control 文本键，Command 仍可打开应用功能", async ({
  page,
}) => {
  await fixture(page);
  const title = page.getByRole("textbox", { name: "文档标题", exact: true });
  await title.focus();
  for (const key of [
    "f",
    "b",
    "n",
    "p",
    "a",
    "e",
    "d",
    "h",
    "k",
    "o",
    "t",
    "y",
  ]) {
    expect(await nativeControlAllowed(title, key), key).toBe(true);
    await expect(title).toBeFocused();
  }
  await expect(
    page.locator(".quick-switcher-overlay, .editor-find-bar"),
  ).toHaveCount(0);
  await title.press("Meta+p");
  await expect(page.locator(".quick-switcher-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await title.press("Meta+f");
  await expect(page.locator(".editor-find-bar")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "源码", exact: true }).click();
  const source = page.getByRole("textbox", {
    name: "Markdown 源码",
    exact: true,
  });
  await source.focus();
  for (const key of ["a", "f", "b", "n", "p", "e"])
    expect(await nativeControlAllowed(source, key), key).toBe(true);
  await source.press("Meta+a");
  expect(
    await source.evaluate((element) => {
      const area = element as HTMLTextAreaElement;
      return area.selectionEnd - area.selectionStart === area.value.length;
    }),
  ).toBe(true);
});

test("Mac 正文放行原生移动，代码块 Ctrl+A/E 移动光标而 Command+A 选择内容", async ({
  page,
}) => {
  const editor = await fixture(page);
  await editor.evaluate((element) => {
    const editor = (
      element as HTMLElement & { editor: import("@tiptap/core").Editor }
    ).editor;
    editor.commands.setTextSelection(4);
    editor.view.focus();
  });
  for (const key of ["f", "b"])
    expect(await nativeControlAllowed(editor, key), key).toBe(true);
  for (const key of ["n", "p"]) await nativeControlAllowed(editor, key);
  await expect(
    page.locator(".quick-switcher-overlay, .editor-find-bar"),
  ).toHaveCount(0);

  const start = await editor.evaluate((element) => {
    const editor = (
      element as HTMLElement & { editor: import("@tiptap/core").Editor }
    ).editor;
    let start = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock") start = pos + 1;
    });
    editor.commands.setTextSelection(start + 3);
    editor.view.focus();
    return start;
  });
  const selection = () =>
    editor.evaluate((element) => {
      const { from, to } = (
        element as HTMLElement & { editor: import("@tiptap/core").Editor }
      ).editor.state.selection;
      return { from, to };
    });
  await editor.press("Control+a");
  await expect.poll(selection).toEqual({ from: start, to: start });
  await editor.press("Control+e");
  await expect.poll(selection).toEqual({ from: start + 9, to: start + 9 });
  await editor.press("Meta+a");
  await expect.poll(selection).toEqual({ from: start, to: start + 9 });
});

test("Mac Vim Normal 保留 Control 翻页，Insert 恢复原生前后移动", async ({
  page,
}) => {
  const editor = await fixture(page);
  await editor.evaluate(async (element) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { setVimModeEnabled } = await load("/src/extensions/VimMode.ts");
    const editor = (
      element as HTMLElement & { editor: import("@tiptap/core").Editor }
    ).editor;
    setVimModeEnabled(editor, true);
    editor.commands.setTextSelection(4);
    editor.view.focus();
  });
  await expect(editor).toHaveAttribute("data-vim-mode", "normal");
  expect(await nativeControlAllowed(editor, "f")).toBe(false);
  expect(await nativeControlAllowed(editor, "p")).toBe(false);
  await expect(
    page.locator(".quick-switcher-overlay, .editor-find-bar"),
  ).toHaveCount(0);
  await editor.press("i");
  await expect(editor).toHaveAttribute("data-vim-mode", "insert");
  await editor.evaluate((element) =>
    (
      element as HTMLElement & { editor: import("@tiptap/core").Editor }
    ).editor.commands.setTextSelection(4),
  );
  expect(await nativeControlAllowed(editor, "f")).toBe(true);
});

test("Mac 资料库和 PDF 查找输入保留 Ctrl+F，Cmd+F 仍打开搜索", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "PDF / EPUB 阅读", exact: true })
    .click();
  const library = page.getByRole("region", { name: "阅读资料库", exact: true });
  const filter = library.getByRole("searchbox", { name: "查找书籍" });
  await filter.focus();
  expect(await nativeControlAllowed(filter, "f")).toBe(true);
  await page.locator('input[accept="application/pdf,.pdf"]').setInputFiles({
    name: "mac-shortcuts.pdf",
    mimeType: "application/pdf",
    buffer: createPdfFixture(),
  });
  await expect(page.locator(".pdf-text-layer").first()).toContainText(
    "Nine Rings PDF MVP",
  );
  await page
    .locator(".reader-toolbar")
    .getByRole("button", { name: "PDF 搜索", exact: true })
    .press("Meta+f");
  const search = page.locator('[data-reader-panel="search"] input');
  await expect(search).toBeFocused();
  await search.fill("Nine Rings");
  expect(await nativeControlAllowed(search, "f")).toBe(true);
  await expect(search).toHaveValue("Nine Rings");
});

test("Mac 快捷键设置拒绝占用原生 Control 文本组合", async ({ page }) => {
  await fixture(page);
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^快捷键/ }).click();
  const row = page.locator(".hotkey-row").filter({ hasText: "聚焦搜索" });
  await row.locator(".hotkey-btn").click();
  await row.locator("input").press("Control+p");
  await expect(page.locator(".hotkey-recording-error")).toContainText(
    "macOS 文本编辑",
  );
  await expect(row.locator("kbd")).toHaveText("⌥ + E");
});

test("Mac 代码弹层保留 Control 导航，Command 处理查找和撤销重做", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "放大阅读代码块", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "代码块工作区",
    exact: true,
  });
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  const code = dialog.locator(".cm-content");
  await code.click();
  await code.pressSequentially("ggVGc");
  await page.keyboard.insertText("changed code");
  await code.press("Escape");
  await expect(code).toHaveText("changed code");
  await code.press("Meta+z");
  await expect(code).toHaveText("code text");
  await code.press("Control+y");
  await expect(code).toHaveText("code text");
  await code.press("Meta+Shift+z");
  await expect(code).toHaveText("changed code");
  await code.press("Control+f");
  await expect(dialog.getByRole("search")).toHaveCount(0);
  await code.press("Meta+f");
  const search = dialog.getByRole("textbox", {
    name: "在当前块查找",
    exact: true,
  });
  await expect(search).toBeFocused();
  expect(await nativeControlAllowed(search, "f")).toBe(true);
});

test("Windows Ctrl+P 仍打开切换器，Ctrl+A 仍选择代码块", async ({ page }) => {
  const editor = await fixture(page, "Win32");
  await page
    .getByRole("textbox", { name: "文档标题", exact: true })
    .press("Control+p");
  await expect(page.locator(".quick-switcher-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await editor.locator("pre code").click();
  await editor.press("Control+a");
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("code text");
});
