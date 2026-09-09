import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";

test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });
test("硬换行混合中文、emoji 和自动折行时，代码行号对齐首行", async ({ page }) => {
  await page.goto("/");
  const source = page.locator(".note-editor .ProseMirror");
  await expect(source).toBeVisible({ timeout: 15000 });
  const lines = [
    "右划弹层的返回按钮，〈，需要和其它工具一样占用相同的空间，并且它们都靠右对齐。",
    "右侧左划弹层的下方也有类似之前那个下边未完全覆盖的问题，修复一下。完成后提交推送。",
    "右侧左划，改为上半部划出目录，下半部划出书签。",
    "工具栏，前几个按钮之间有｜间隔，后面的没有，这是为什么？",
    "将工具栏的🔗按钮放到更多，把块内换行移出来。",
    "苹果输入法连续输入两个空格可以变成。，在nine rings中为什么不支持？",
    "", "\t  const value = '中文😀'; // mixed fonts and wrapped long text abcdefghijklmnopqrstuvwxyz",
    "", "最后一行", "",
  ];
  await source.evaluate((el, code) => (el as HTMLElement & { editor: Editor }).editor.commands.setContent({ type: "doc", content: [{ type: "codeBlock", attrs: { language: "javascript", wrap: true }, content: [{ type: "text", text: code }] }] }), [...lines, ...lines].join("\n"));
  await page.getByRole("button", { name: "放大阅读代码块" }).tap();
  const dialog = page.getByRole("dialog", { name: "代码块工作区" });
  await dialog.getByRole("button", { name: "显示代码行号", exact: true }).click();
  for (const width of [390, 760, 430]) {
    await page.setViewportSize({ width, height: width === 760 ? 390 : 760 });
    for (const fontSize of [16, 20]) {
      await dialog.locator(".block-workspace-body").evaluate((el, size) => { (el as HTMLElement).style.fontSize = `${size}px`; }, fontSize);
      await expect.poll(() => dialog.evaluate(el => {
        const code = el.querySelector("pre code")!;
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        const spans: { node: Node; from: number; to: number }[] = [];
        let offset = 0;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          spans.push({ node, from: offset, to: offset + node.textContent!.length }); offset += node.textContent!.length;
        }
        const numbers = [...el.querySelectorAll(".code-block-gutter span")];
        let from = 0;
        const errors = code.textContent!.split("\n").map((line, index) => {
          const start = from; from += line.length + 1;
          if (!line.trim()) return 0;
          const span = spans.find(span => span.from <= start && span.to > start)!;
          const range = document.createRange(); range.setStart(span.node, start - span.from); range.setEnd(span.node, start - span.from + 1);
          const number = document.createRange(); number.selectNodeContents(numbers[index]);
          const glyph = [...range.getClientRects()].find(rect => rect.width > 0 && rect.height > 0)!;
          return Math.abs(glyph.top - number.getBoundingClientRect().top);
        });
        return Math.max(...errors);
      })).toBeLessThan(5);
    }
  }
});
