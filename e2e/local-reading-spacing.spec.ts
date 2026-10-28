import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";

const markdown = "# 标题\n\n## 连续标题\n\n### 连续子标题\n\n普通正文一。\n\n普通正文二。\n\n## 小节\n\n小节正文。\n\n- 条目一\n- 条目二\n\n列表后正文。\n\n> 引用正文\n\n```c\nint main(void) { return 0; }\n```\n\n末段正文。\n\n---\n\n分隔线后的正文。\n\n<details>\n<summary>展开说明</summary>\n\n说明内容\n\n</details>\n\n最后正文。";
for (const style of ["classic", "calm", "paper", "minimal", "nine-rings", "mono-aware", "yugen", "wabi-sabi"]) for (const width of [1280, 390]) test(`本地与数据库文档共享块间距 ${style} ${width}`, async ({ page }, testInfo) => {
  await page.addInitScript(style => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: style, interface_font_size: 20, interface_line_height: 1.9, interface_block_spacing_px: 9, interface_heading_margin_top_px: 22, interface_heading_margin_bottom_px: 6, editor_show_line_numbers: true })), style);
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await page.setViewportSize({ width, height: 900 });
  await page.locator(".ProseMirror:visible").evaluate(async (element, source) => {
    const { parseFlowDocument } = await import("/src/components/FlowBlockContent.tsx");
    (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.commands.setContent(parseFlowDocument(source).toJSON(), true);
  }, markdown);
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  const database = await page.locator(".note-editor .editor-content .ProseMirror").evaluate(root => Array.from(root.children).map(node => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return { top: rect.top, bottom: rect.bottom, font: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight };
  }));
  await page.evaluate(async () => {
    (await import("/src/lib/plugin-system/runtime.ts")).setPluginsEnabled(true);
    (await import("/src/lib/plugin-system/builtin-local-files.ts")).saveLocalFilesEnabled(true);
    Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
  });
  if (width === 390) await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  const root = testInfo.outputPath("spacing");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "spacing.md"), markdown);
  const tree = page.getByRole("region", { name: "本地文件树" });
  await tree.locator("input[type=file]").setInputFiles(root);
  await tree.getByRole("button", { name: "spacing.md", exact: true }).click();
  await page.setViewportSize({ width, height: 900 });
  await page.getByRole("region", { name: "本地文件工作区" }).getByRole("button", { name: "渲染", exact: true }).click();
  const local = page.locator(".markdown-reading-view");
  await expect(local.locator("h1")).toHaveText("标题");
  const metrics = await local.locator(".ProseMirror > *").evaluateAll(rows => rows.map(row => {
    const rect = row.getBoundingClientRect(), style = getComputedStyle(row);
    return { top: rect.top, bottom: rect.bottom, font: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight };
  }));
  expect(metrics).toHaveLength(database.length);
  for (let index = 0; index < metrics.length; index++) {
    expect({ font: metrics[index].font, size: metrics[index].size, lineHeight: metrics[index].lineHeight }).toEqual({ font: database[index].font, size: database[index].size, lineHeight: database[index].lineHeight });
  }
  for (let index = 1; index < metrics.length; index++) {
    const actual = metrics[index].top - metrics[index - 1].bottom;
    const expected = database[index].top - database[index - 1].bottom;
    expect(actual, `第 ${index + 1} 块之前的间距`).toBeCloseTo(expected, 0);
  }
});
