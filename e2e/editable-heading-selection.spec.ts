import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

test("编辑模式双击各级英文标题会选中当前单词", async ({ page }) => {
  await createBlankDocument(page);
  const root = page.locator(".ProseMirror");
  await root.evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({
      type: "doc",
      content: Array.from({ length: 6 }, (_, index) => ({
        type: "heading",
        attrs: { level: index + 1 },
        content: [{ type: "text", text: `Level${index + 1} English Heading` }],
      })),
    });
  });

  for (let level = 1; level <= 6; level += 1) {
    const heading = root.locator(`h${level}`);
    await heading.scrollIntoViewIfNeeded();
    // Hit the first word's text, independent of heading padding and font size.
    const position = await heading.evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text && !text.textContent?.startsWith("Level")) text = walker.nextNode();
      if (!text) throw new Error("heading word missing");
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 3);
      const word = range.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return { x: word.x + word.width / 2 - box.x, y: word.y + word.height / 2 - box.y };
    });
    await heading.dblclick({ position });
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(`Level${level}`);
    await expect.poll(() => root.evaluate(element => {
      const editor = (element as HTMLElement & { editor: Editor }).editor;
      const { from, to } = editor.state.selection;
      return editor.state.doc.textBetween(from, to, "\n");
    })).toBe(`Level${level}`);
  }

  // Replacing the selected first word must not consume the preceding block boundary.
  await page.keyboard.type("Replacement");
  await expect(root.locator("h1,h2,h3,h4,h5,h6")).toHaveCount(6);
  await expect(root.locator("h5")).toHaveText("Level5 English Heading");
  await expect(root.locator("h6")).toHaveText("Replacement English Heading");
});
