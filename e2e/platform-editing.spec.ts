import { expect, test, type Locator } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";
import { pressDocumentBoundary, pressLineBoundary } from "./helpers/keyboard";
import { requireNativeClipboard } from "./helpers/native-clipboard";

async function seed(editor: Locator, lines: string[]) {
  await editor.evaluate((el, lines) => {
    const instance = (el as HTMLElement & { editor: Editor }).editor;
    instance
      .chain()
      .setContent({
        type: "doc",
        content: lines.map((text) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        })),
      })
      .setMeta("addToHistory", false)
      .run();
  }, lines);
  await expect(editor.locator("p")).toHaveText(lines);
  await editor.locator("p").last().click();
  await expect(editor).toBeFocused();
}

// Run on real macOS/Linux/Windows hosts without overriding navigator.platform.
test("本机主快捷键支持全选、撤销重做和快速切换", async ({ page }) => {
  await createBlankDocument(page);
  const editor = page.locator(".note-editor .ProseMirror");
  await seed(editor, ["原始正文"]);
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText("替换正文");
  await expect(editor).toHaveText("替换正文");
  await editor.press("ControlOrMeta+z");
  await expect(editor).toHaveText("原始正文");
  await editor.press("ControlOrMeta+Shift+z");
  await expect(editor).toHaveText("替换正文");
  await editor.press("ControlOrMeta+p");
  await expect(page.locator(".quick-switcher-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".quick-switcher-overlay")).toBeHidden();
});

test("本机行首行尾和文档边界按键保持多段正文", async ({ page }) => {
  await createBlankDocument(page);
  const editor = page.locator(".note-editor .ProseMirror");
  await seed(editor, ["first", "second", "third"]);
  await pressDocumentBoundary(editor, "start");
  await expect
    .poll(() =>
      editor.evaluate(() => ({
        text: window.getSelection()?.anchorNode?.textContent,
        offset: window.getSelection()?.anchorOffset,
      })),
    )
    .toEqual({ text: "first", offset: 0 });
  await pressLineBoundary(editor, "end");
  await pressLineBoundary(editor, "start", true);
  await page.keyboard.insertText("FIRST");
  await expect(editor.locator("p")).toHaveText(["FIRST", "second", "third"]);
  await pressDocumentBoundary(editor, "end");
  await page.keyboard.insertText("-END");
  await expect(editor.locator("p")).toHaveText([
    "FIRST",
    "second",
    "third-END",
  ]);
});

test("本机原生复制粘贴保留文本并可撤销", async ({ page, context }) => {
  await requireNativeClipboard(context);
  await createBlankDocument(page);
  const editor = page.locator(".note-editor .ProseMirror");
  await seed(editor, ["clipboard roundtrip"]);
  await editor.press("ControlOrMeta+a");
  await editor.press("ControlOrMeta+c");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("clipboard roundtrip");
  await pressDocumentBoundary(editor, "end");
  await expect
    .poll(() =>
      editor.evaluate(
        (el) =>
          (el as HTMLElement & { editor: Editor }).editor.state.selection.empty,
      ),
    )
    .toBe(true);
  await editor.press("Enter");
  await editor.press("ControlOrMeta+v");
  await expect(editor.locator("p")).toHaveText([
    "clipboard roundtrip",
    "clipboard roundtrip",
  ]);
  await editor.press("ControlOrMeta+z");
  await expect(editor).toHaveText("clipboard roundtrip");
});
