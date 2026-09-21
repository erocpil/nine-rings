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
    await heading.click({ position: { x: 12, y: 10 } });
    const box = (await heading.boundingBox())!;
    await heading.dispatchEvent("dblclick", {
      button: 0,
      clientX: box.x + 12,
      clientY: box.y + box.height / 2,
    });
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(`Level${level}`);
  }
});
