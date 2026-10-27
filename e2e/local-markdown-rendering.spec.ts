import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";
import { sourceInfo, selectSource } from "./helpers/source-editor";

const markdown = [
  "# 磁盘 Markdown",
  "```toc\nlevels: 1,2,3\n```",
  "**粗体**、*斜体*和 `inline_code`。脚注[^1]。",
  "[跳转章节](#第二节)",
  "## 第二节",
  "> 引用内容\n>\n> - 列表项目",
  "| 名称 | 值 |\n| --- | --- |\n| 表格 | 正常 |",
  "$E=mc^2$",
  "<details>\n<summary>展开说明</summary>\n\n折叠的正文。\n\n</details>",
  "```c\nint main(void) {\n\treturn 0;\n}\n```",
  ...Array.from({ length: 25 }, (_, index) => `段落 ${index}：用于核验滚动与模式切换位置。`),
  "[^1]: 来自本地文件的脚注内容。",
].join("\n\n");

for (const width of [1280, 390]) test(`本地 Markdown 渲染复用目录、脚注和特殊块，往返保留原文与阅读状态 ${width}`, async ({ page }, testInfo) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await page.evaluate(async () => {
    const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    const { saveLocalFilesEnabled } = await import("/src/lib/plugin-system/builtin-local-files.ts");
    setPluginsEnabled(true);
    saveLocalFilesEnabled(true);
    Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
  });
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  const panel = page.getByRole("region", { name: "本地文件树" });
  const root = testInfo.outputPath("markdown-rendering");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "guide.md"), markdown);
  await panel.locator("input[type=file]").setInputFiles(root);
  await panel.getByRole("button", { name: "guide.md", exact: true }).click();
  await page.setViewportSize({ width, height: 900 });
  const viewer = page.getByRole("region", { name: "本地文件工作区" });
  const area = viewer.locator(".cm-content");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(markdown);
  await viewer.getByRole("button", { name: "渲染", exact: true }).click();
  const rendered = viewer.getByLabel("Markdown 渲染", { exact: true });
  await expect(rendered.locator("h1")).toHaveText("磁盘 Markdown");
  await expect(rendered.locator("strong").filter({ hasText: /^粗体$/ })).toBeVisible();
  await expect(rendered.locator("em")).toHaveText("斜体");
  await expect(rendered.locator("table td").first()).toHaveText("表格");
  await expect(rendered.locator(".katex")).toBeVisible();
  const toc = rendered.getByRole("navigation", { name: "文档内目录" });
  await expect(toc.getByRole("link", { name: "第二节", exact: true })).toBeVisible();
  await toc.getByRole("link", { name: "第二节", exact: true }).click();
  await expect.poll(() => rendered.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await rendered.locator(".nr-details-summary").click();
  await expect(rendered.locator("details")).toHaveAttribute("open", "");
  await rendered.getByRole("button", { name: "折叠代码块", exact: true }).click();
  await expect(rendered.locator(".code-block-wrap")).toHaveClass(/collapsed/);
  await rendered.evaluate(element => { element.scrollTop = 0; });
  await rendered.locator(".nr-footnote-reference a").click();
  await expect(rendered.locator(".nr-footnotes")).toBeInViewport();
  const readingTop = await rendered.evaluate(element => element.scrollTop);
  await viewer.getByRole("button", { name: "显示源码", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(markdown);
  await viewer.getByRole("button", { name: "渲染", exact: true }).click();
  await expect.poll(() => rendered.evaluate(element => element.scrollTop)).toBe(readingTop);
  await expect(rendered.locator("details")).toHaveAttribute("open", "");
  await expect(rendered.locator(".code-block-wrap")).toHaveClass(/collapsed/);
  await viewer.getByRole("button", { name: "显示源码", exact: true }).click();
  // An editable source keeps its existing undo history across the derived rendering.
  if (await area.getAttribute("contenteditable") === "true") {
    await selectSource(area, markdown.length);
    await page.keyboard.insertText("\n\n新增正文");
    await viewer.getByRole("button", { name: "渲染", exact: true }).click();
    await expect(rendered.getByText("新增正文", { exact: true })).toBeVisible();
    await viewer.getByRole("button", { name: "显示源码", exact: true }).click();
    await area.focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect.poll(async () => (await sourceInfo(area)).value).toBe(markdown);
  }
});

test("本地 Mermaid 与 Flow 文件复用独立文档渲染，源码保持原样", async ({ page }, testInfo) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await page.evaluate(async () => {
    const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    const { saveLocalFilesEnabled } = await import("/src/lib/plugin-system/builtin-local-files.ts");
    setPluginsEnabled(true);
    saveLocalFilesEnabled(true);
    Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
  });
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  const panel = page.getByRole("region", { name: "本地文件树" });
  const root = testInfo.outputPath("standalone-rendering");
  const files = [
    { name: "diagram.mmd", language: "Mermaid", text: "flowchart LR\n A[Start] --> B[End]" },
    { name: "steps.flow", language: "Flow", text: "### 第一步\n\n准备材料\n\n### 第二步\n\n开始执行" },
  ];
  await mkdir(root, { recursive: true });
  for (const file of files) await writeFile(join(root, file.name), file.text);
  await panel.locator("input[type=file]").setInputFiles(root);
  const viewer = page.getByRole("region", { name: "本地文件工作区" });
  for (const file of files) {
    await panel.getByRole("button", { name: file.name, exact: true }).click();
    await expect(viewer.locator(".cm-content")).toBeVisible();
    await viewer.getByRole("button", { name: "渲染", exact: true }).click();
    const rendered = viewer.getByLabel(`${file.language} 渲染`, { exact: true });
    if (file.language === "Mermaid") await expect(rendered.locator("svg")).toBeVisible();
    else await expect(rendered.getByText("准备材料", { exact: true })).toBeVisible();
    await viewer.getByRole("button", { name: "显示源码", exact: true }).click();
    await expect.poll(async () => (await sourceInfo(viewer.locator(".cm-content"))).value).toBe(file.text);
  }
});
