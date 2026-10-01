import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

for (const width of [390, 1280]) {
test(`小型 Markdown 表格按内容收紧 ${width}`, async ({ page }) => {
  await createBlankDocument(page, "紧凑表格");
  await page.setViewportSize({ width, height: 800 });
  const editor = page.locator(".note-editor .ProseMirror");
  await editor.evaluate(async (element) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { mdToDelta } = await load("/src/lib/md-parser.ts");
    const { deltaToProseMirror } = await load("/src/lib/delta-converter.ts");
    const instance = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    instance.commands.setContent(deltaToProseMirror(mdToDelta("| 功能 | 状态 |\n| :--- | :--- |\n| 主题 | ✅ 完成 |\n| 分栏 | ✅ 完成 |\n| ⌘K | ✅ 完成 |")), true);
  });
  const dimensions = await editor.evaluate(element => ({
    content: element.getBoundingClientRect().width,
    table: element.querySelector("table")!.getBoundingClientRect().width,
    wrapper: element.querySelector(".tableWrapper")!.getBoundingClientRect().width,
  }));
  expect(dimensions.table).toBeGreaterThan(150);
  expect(dimensions.table).toBeLessThan(dimensions.content * 0.75);
  expect(dimensions.wrapper).toBeLessThan(dimensions.content * 0.75);
  const scrollbarHeight = await editor.evaluate(element =>
    CSS.supports("selector(::-webkit-scrollbar)")
      ? getComputedStyle(element.querySelector(".tableWrapper")!, "::-webkit-scrollbar").height
      : null,
  );
  if (scrollbarHeight !== null) expect(scrollbarHeight).toBe("4px");
});
}
