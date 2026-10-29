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
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true })));
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
  await viewer.getByRole("button", { name: "设为只读", exact: true }).click();
  await viewer.getByRole("button", { name: "渲染", exact: true }).click();
  const rendered = viewer.getByLabel("Markdown 渲染", { exact: true });
  await expect(rendered.locator("h1")).toHaveText("磁盘 Markdown");
  // The reusable reader accepts reading transactions, never canonical text edits.
  const body = rendered.locator(".ProseMirror");
  await expect(body).toHaveAttribute("contenteditable", "false");
  expect(await body.evaluate(element => {
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    const before = JSON.stringify(editor.state.doc.toJSON());
    editor.commands.insertContent("不应写入的正文");
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "# 不应粘贴的标题");
    const prevented = !element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    return prevented && before === JSON.stringify(editor.state.doc.toJSON());
  })).toBe(true);
  const rowCount = await rendered.locator(".ProseMirror > *:visible").count();
  await expect(rendered.locator(".editor-block-number").first()).toBeVisible();
  await expect(rendered.locator(".editor-block-number").first()).toHaveText("1");
  const chapterFold = rendered.locator("h1 .editor-heading-fold");
  await chapterFold.click();
  await expect(rendered.locator(".ProseMirror > *:visible")).toHaveCount(1);
  await expect(chapterFold).toHaveAttribute("aria-expanded", "false");
  await chapterFold.click();
  await expect(rendered.locator(".ProseMirror > *:visible")).toHaveCount(rowCount);
  await rendered.getByRole("button", { name: "第 3 块操作", exact: true }).click();
  const blockMenu = page.getByRole("menu", { name: "第 3 块", exact: true });
  await expect(blockMenu.getByRole("menuitem", { name: "复制 Markdown", exact: true })).toBeVisible();
  await expect(blockMenu.getByRole("menuitem", { name: "删除此块", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(blockMenu).toHaveCount(0);
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
  const code = rendered.locator(".code-block-wrap").filter({ hasText: "int main" });
  const numbers = code.locator(".code-block-gutter > span");
  const initiallyNumbered = await numbers.count() > 0;
  await code.getByRole("button", { name: initiallyNumbered ? "隐藏代码行号" : "显示代码行号", exact: true }).click();
  if (initiallyNumbered) await expect(numbers).toHaveCount(0);
  else await expect(numbers).toHaveCount(3);
  await code.getByRole("button", { name: initiallyNumbered ? "显示代码行号" : "隐藏代码行号", exact: true }).click();
  await code.getByRole("button", { name: "放大阅读代码块", exact: true }).click();
  const workspace = page.getByRole("dialog", { name: "代码块工作区", exact: true });
  await expect(workspace).toBeVisible();
  await expect(workspace).toContainText("int main");
  await expect(workspace.getByRole("button", { name: "切换到编辑模式", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(workspace).toHaveCount(0);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
  const find = viewer.getByRole("search", { name: "文档查找", exact: true });
  await find.getByRole("textbox", { name: "在当前文档中查找", exact: true }).fill("引用内容");
  await expect(find.getByRole("status")).toHaveText("0/1");
  await page.keyboard.press("Enter");
  await expect(find.getByRole("status")).toHaveText("1/1");
  await expect(rendered.locator(".search-match-active")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(find).toHaveCount(0);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+g" : "Control+g");
  const jump = viewer.getByRole("dialog", { name: "跳转块", exact: true });
  await jump.getByRole("textbox", { name: "跳转到块号", exact: true }).fill("3");
  await jump.getByRole("button", { name: "跳转", exact: true }).click();
  await expect(jump).toHaveCount(0);
  await expect(rendered.locator(".ProseMirror > :nth-child(3)")).toHaveClass(/ProseMirror-activeline/);
  await rendered.evaluate(async element => {
    let previous = element.scrollTop, stable = 0;
    for (let frame = 0; frame < 120 && stable < 4; frame++) {
      await new Promise(requestAnimationFrame);
      stable = Math.abs(previous - element.scrollTop) < 1 ? stable + 1 : 0;
      previous = element.scrollTop;
    }
  });
  await rendered.getByRole("button", { name: "第 3 块操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "添加块书签", exact: true }).click();
  await viewer.getByRole("button", { name: "文档书签", exact: true }).click();
  const bookmarks = viewer.getByRole("navigation", { name: "文档书签", exact: true });
  await expect(bookmarks).toContainText("粗体");
  await rendered.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await bookmarks.getByRole("button").filter({ hasText: "粗体" }).click();
  await expect(rendered.locator(".ProseMirror > :nth-child(3)")).toBeInViewport();
  await viewer.getByRole("button", { name: "文档书签", exact: true }).click();
  await rendered.getByRole("button", { name: "折叠代码块", exact: true }).click();
  await expect(code).toHaveClass(/collapsed/);
  await rendered.evaluate(element => { element.scrollTop = 0; });
  await rendered.locator(".nr-footnote-reference a").click();
  await expect(rendered.locator(".nr-footnotes")).toBeInViewport();
  const readingTop = await rendered.evaluate(element => element.scrollTop);

  await viewer.getByRole("button", { name: "显示源码", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(markdown);
  await viewer.getByRole("button", { name: "渲染", exact: true }).click();
  await expect.poll(() => rendered.evaluate(element => element.scrollTop)).toBe(readingTop);
  await expect(rendered.locator("details")).toHaveAttribute("open", "");
  await expect(code).toHaveClass(/collapsed/);
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
  await viewer.getByRole("button", { name: "渲染", exact: true }).click();
  // Plugin ownership must update visibility, relative numbers, fonts and symbols live.
  await page.evaluate(async () => {
    const { saveNumberingPreference, DEFAULT_NUMBERING_DISPLAYS } = await import("/src/lib/plugin-system/builtin-numbering-display.ts");
    saveNumberingPreference({ enabled: true, displays: DEFAULT_NUMBERING_DISPLAYS.map(display => display.target === "blocks"
      ? { ...display, fontSize: 17, relative: true, currentAlignment: "left", foldExpanded: "−", foldCollapsed: "+" }
      : display) });
  });
  await rendered.locator(".ProseMirror > :nth-child(3)").click();
  await expect(rendered.locator('.editor-block-number[data-block-index="3"]')).toHaveClass(/relative-current/);
  await expect(rendered.locator('.editor-block-number[data-block-index="3"]')).toHaveText("3");
  await expect(rendered.locator('.editor-block-number').first()).toHaveText("2");
  await expect(rendered.locator('.editor-block-number').first()).toHaveCSS("font-size", "17px");
  await expect(chapterFold).toHaveText("−");
  await chapterFold.click();
  await expect(rendered.locator(".ProseMirror > *:visible")).toHaveCount(1);
  await expect(chapterFold).toHaveText("+");
  const band = rendered.locator(".editor-block-current-band");
  await expect(band).toBeVisible();
  const bandBounds = (await band.boundingBox())!, rowBounds = (await rendered.locator(".ProseMirror > *:visible").boundingBox())!;
  expect(Math.abs(bandBounds.height - rowBounds.height)).toBeLessThanOrEqual(1);
  await viewer.getByRole("button", { name: "显示源码", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(markdown);
  await viewer.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(rendered.locator(".ProseMirror > *:visible")).toHaveCount(1);
  await viewer.getByRole("button", { name: "文档目录", exact: true }).click();
  const outline = viewer.getByRole("navigation", { name: "文档目录", exact: true });
  await outline.getByRole("button", { name: "全部展开", exact: true }).click();
  await outline.getByRole("button", { name: "H2 第二节", exact: true }).click();
  await expect(rendered.locator(".ProseMirror > *:visible")).toHaveCount(rowCount);
  const outlineTrigger = viewer.getByRole("button", { name: "文档目录", exact: true });
  if (await outlineTrigger.getAttribute("aria-expanded") === "true") await outlineTrigger.click();
  await page.evaluate(async () => {
    const { saveNumberingPreference, readNumberingPreference } = await import("/src/lib/plugin-system/builtin-numbering-display.ts");
    const preference = readNumberingPreference();
    saveNumberingPreference({ ...preference, displays: preference.displays.map(display => display.target === "blocks" ? { ...display, visible: false } : display) });
  });
  await expect(rendered.locator(".editor-block-number")).toHaveCount(0);
  await expect(chapterFold).toBeVisible();
  await rendered.evaluate(element => { element.scrollTop = 0; });
  if (width === 1280) await page.getByRole("button", { name: "专注模式", exact: true }).click();
  else await page.evaluate(async () => (await import("/src/lib/native-menu-registry.ts")).runNativeMenuAction("view.focus"));
  await expect(page.locator(".app")).toHaveClass(/app-focus-mode/);
  if (width === 1280) {
    await rendered.locator("h1").dblclick();
  } else {
    await rendered.locator("h1").evaluate(element => {
      const rect = element.getBoundingClientRect(), x = rect.left + 30, y = rect.top + 10;
      for (let tap = 0; tap < 2; tap++) {
        element.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, bubbles: true }));
        element.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      }
    });
  }
  await expect(rendered.locator(".ProseMirror > *:visible")).toHaveCount(1);
  await chapterFold.click();
  await expect(rendered.locator(".ProseMirror > *:visible")).toHaveCount(rowCount);
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
