import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankNote as createBlankNoteFixture } from "./helpers/editor-fixtures";

test("blockquote stays unpositioned and retains text input in one paragraph", async ({ page }) => {
  await createBlankNoteFixture(page);
  const editor = page.locator(".note-editor .ProseMirror");
  await editor.evaluate((element) => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    instance.commands.setContent({
      type: "doc",
      content: [{
        type: "blockquote",
        content: [{ type: "paragraph", content: [{ type: "text", text: "五笔输入起点" }] }],
      }],
    });
  });

  const quote = editor.locator(":scope > blockquote");
  const paragraph = quote.locator("p");
  await expect(quote).toHaveCSS("position", "static");
  await paragraph.click();
  await page.keyboard.insertText(" 中文提交");
  await expect(quote.locator("p")).toHaveCount(1);
  await expect(paragraph).toHaveText("五笔输入起点 中文提交");
});
