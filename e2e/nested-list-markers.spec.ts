import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";

for (const width of [390, 1280]) {
  for (const readonly of [false, true]) {
    test(`多级方块标记不使用 emoji 或遮挡正文 ${width} ${readonly ? "只读" : "编辑"}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      const editor = page.locator(".note-editor .ProseMirror");
      await expect(editor).toBeVisible();
      await editor.evaluate((element, readonly) => {
        const instance = (element as HTMLElement & { editor: Editor }).editor;
        instance.commands.setContent("<ul><li><p>约束</p><ul><li><p>必须为每个 ring 定义：</p><ul><li><p>单/多生产者与单/多消费者模式，选择匹配的 SP/SC 或 MP/MC 语义；</p></li><li><p>满队列策略，例如丢包、重试、旁路或向上游施加背压；</p><ul><li><p>第四级正文同样不能被标记遮挡，换行后仍应保持对齐。</p></li></ul></li></ul></li></ul></li></ul>");
        instance.setEditable(!readonly);
      }, readonly);
      for (const size of [18, 26]) {
        const geometry = await editor.evaluate((element, size) => {
          (element as HTMLElement).style.fontSize = `${size}px`;
          return [...element.querySelectorAll("li li > ul > li")].map(item => {
            const style = getComputedStyle(item, "::before");
            const box = item.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(item.querySelector(":scope > p")!);
            const lines = [...range.getClientRects()];
            return {
              content: style.content,
              background: style.backgroundImage,
              height: parseFloat(style.height),
              lineHeight: parseFloat(getComputedStyle(item).lineHeight),
              markerRight: box.right - parseFloat(style.right),
              textLeft: Math.min(...lines.map(line => line.left)),
              lineLefts: lines.map(line => line.left),
            };
          });
        }, size);
        expect(geometry).toHaveLength(3);
        for (const item of geometry) {
          expect(item.content).toBe('""');
          expect(item.background).toContain("linear-gradient");
          // WebKit rounds the used lh length to a CSS pixel.
          expect(Math.abs(item.height - item.lineHeight)).toBeLessThanOrEqual(1);
          expect(item.markerRight).toBeLessThan(item.textLeft - 1);
          for (const left of item.lineLefts) expect(left).toBeCloseTo(item.textLeft, 1);
        }
      }
      await page.screenshot({ path: `/tmp/nr-nested-list-${width}-${readonly}.png` });
    });
  }
}
