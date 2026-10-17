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

test("所有风格明暗与手机宽度均保留物哀式引用左标记", async ({ page }) => {
  await createBlankNoteFixture(page);
  const editor = page.locator(".note-editor .ProseMirror");
  await editor.evaluate(element => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    instance.commands.setContent({ type: "doc", content: [
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "引用正文" }] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [
        { type: "paragraph", content: [{ type: "text", text: "条目" }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "嵌套引用" }] }] },
      ] }] },
    ] });
  });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const theme of ["light", "dark"]) {
      for (const style of ["classic", "calm", "calm-compact", "paper", "minimal", "nine-rings", "mono-aware", "yugen", "wabi-sabi"]) {
        const result = await editor.evaluate(async (element, { style, theme }) => {
          const { applyInterfaceStyle } = await import("/src/lib/interface-style.ts");
          const { applyTheme } = await import("/src/lib/theme.ts");
          applyInterfaceStyle(style);
          applyTheme(theme);
          const marker = document.createElement("span");
          marker.style.color = "var(--accent)";
          document.body.appendChild(marker);
          const expected = getComputedStyle(marker).color;
          marker.remove();
          return [...element.querySelectorAll("blockquote")].map(quote => {
            const css = getComputedStyle(quote);
            return { width: css.borderLeftWidth, style: css.borderLeftStyle, color: css.borderLeftColor, expected, position: css.position };
          });
        }, { style, theme });
        expect(result, `${style}/${theme}/${width}`).toHaveLength(2);
        for (const quote of result) {
          expect(quote.width).toBe("2px");
          expect(quote.style).toBe("solid");
          expect(quote.color).toBe(quote.expected);
          expect(quote.position).toBe("static");
        }
      }
    }
  }
});
