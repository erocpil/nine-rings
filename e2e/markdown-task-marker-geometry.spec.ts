import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

for (const width of [390, 1280]) {
  test(`任务列表勾选框位于当前行背景内 ${width}`, async ({ page }) => {
    await createBlankDocument(page, "任务标记位置");
    await page.setViewportSize({ width, height: 800 });
    await page.locator(".note-editor .ProseMirror").evaluate(async element => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { mdToDelta } = await load("/src/lib/md-parser.ts");
      const { deltaToProseMirror } = await load("/src/lib/delta-converter.ts");
      const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      editor.commands.setContent(deltaToProseMirror(mdToDelta("- [x] 渲染 Mermaid 图表\n- [x] 渲染脚注\n- [ ] 试着编辑这个列表")), true);
    });
    const items = page.locator(".note-editor .ProseMirror ul > li[data-task-checked]");
    await expect(items).toHaveCount(3);
    for (const item of await items.all()) {
      const geometry = await item.evaluate(element => {
        const list = element.parentElement!.getBoundingClientRect();
        const marker = element.querySelector(":scope > .markdown-task-checkbox")!.getBoundingClientRect();
        return { left: marker.left - list.left, right: list.right - marker.right };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeGreaterThan(0);
    }
  });
}
