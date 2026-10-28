import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";

async function openReadonlyFixture(page: Page, testInfo: TestInfo, origin: "database" | "local", longChapter = false) {
  await createBlankDocument(page, "共享界面");
  let root = page.locator(".note-editor:visible").last();
  if (origin === "database") {
    await page.locator(".ProseMirror:visible").evaluate((element, long) => {
      const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
      (element as any).editor.commands.setContent({ type: "doc", content: [
        ...(long ? Array.from({ length: 30 }, (_, i) => p(`前置正文 ${i}`)) : []),
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "共同标题" }] },
        p("共同正文，可选择并复制。"),
        ...(long ? [...Array.from({ length: 80 }, (_, i) => p(`章节正文 ${i}`)),
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "后续章节" }] },
          ...Array.from({ length: 30 }, (_, i) => p(`后续正文 ${i}`))] : []),
      ] }, true);
    }, longChapter);
    await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  } else {
    await closeDocumentSidebar(page);
    await page.evaluate(async () => {
      const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
      const { saveLocalFilesEnabled } = await import("/src/lib/plugin-system/builtin-local-files.ts");
      setPluginsEnabled(true); saveLocalFilesEnabled(true);
      Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
    });
    await page.getByRole("button", { name: "本地文件", exact: true }).click();
    const directory = testInfo.outputPath("shared-chrome");
    await mkdir(directory, { recursive: true });
    const prefix = longChapter ? Array.from({ length: 30 }, (_, i) => `前置正文 ${i}\n\n`).join("") : "";
    const suffix = longChapter ? Array.from({ length: 80 }, (_, i) => `章节正文 ${i}\n\n`).join("") + "# 后续章节\n\n" + Array.from({ length: 30 }, (_, i) => `后续正文 ${i}\n\n`).join("") : "";
    await writeFile(join(directory, "shared.md"), prefix + "# 共同标题\n\n共同正文，可选择并复制。\n\n" + suffix);
    const tree = page.getByRole("region", { name: "本地文件树" });
    await tree.locator("input[type=file]").setInputFiles(directory);
    await tree.getByRole("button", { name: "shared.md", exact: true }).click();
    root = page.getByRole("region", { name: "本地文件工作区" });
    await root.getByRole("button", { name: "渲染", exact: true }).click();
  }
  return root;
}

for (const origin of ["database", "local"] as const) test(`只读渲染共享工具栏、右键与选区复制：${origin}`, async ({ page }, testInfo) => {
  const root = await openReadonlyFixture(page, testInfo, origin);
  const more = root.getByRole("button", { name: "更多工具", exact: true });
  if (await more.getAttribute("aria-expanded") === "false") await more.click();
  const tools = root.getByRole("toolbar", { name: "文档阅读工具", exact: true });
  await expect(tools).toBeVisible();
  await expect(tools.locator("button")).toHaveCount(5);
  for (const name of ["文档查找", "跳转块", "折叠全部标题", "展开全部标题", "复制"]) await expect(tools.getByRole("button", { name, exact: true })).toBeVisible();
  await tools.getByRole("button", { name: "折叠全部标题", exact: true }).click();
  await tools.getByRole("button", { name: "展开全部标题", exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async (text: string) => { (window as any).copiedDocumentText = text; } });
    Object.defineProperty(navigator.clipboard, "write", { configurable: true, value: async (items: ClipboardItem[]) => {
      const blob = await items[0]!.getType("text/plain");
      (window as any).copiedDocumentText = await blob.text();
    } });
  });
  const paragraph = root.locator(".ProseMirror:visible p").filter({ hasText: "共同正文" }).first();
  await expect(paragraph).toBeVisible();
  await paragraph.evaluate(element => {
    const selection = document.getSelection()!, range = document.createRange();
    range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range);
  });
  await expect(tools.getByRole("button", { name: "复制", exact: true })).toBeEnabled();
  await paragraph.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "正文操作", exact: true });
  await expect(menu).toBeVisible();
  for (const name of ["全选", "复制", "复制块", "添加当前位置书签"]) await expect(menu.getByRole("button", { name, exact: true })).toBeVisible();
  if (origin === "local") await expect(menu.getByRole("button", { name: /复制.*引用/ })).toHaveCount(0);
  await menu.getByRole("button", { name: "复制", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).copiedDocumentText)).toBe("共同正文，可选择并复制。");
  const point = await paragraph.evaluate(element => {
    const selection = document.getSelection()!, range = document.createRange();
    range.setStart(element.firstChild!, 0); range.setEnd(element.firstChild!, 4); selection.removeAllRanges(); selection.addRange(range);
    const rect = range.getBoundingClientRect(); return { x: rect.left + 10, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  const hover = page.getByRole("toolbar", { name: "选区编辑工具", exact: true });
  await expect(hover).toBeVisible();
  await page.evaluate(() => { (window as any).copiedDocumentText = ""; });
  await hover.getByRole("button", { name: "复制", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedDocumentText)).toBe("共同正文");
  await paragraph.click({ button: "right" });
  await expect(menu).toBeVisible();
  await expect(hover).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  if (origin === "local") await expect(page.getByRole("region", { name: "本地文件树" })).toBeVisible();
  await expect(paragraph).toHaveText("共同正文，可选择并复制。");
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  const focusMore = page.getByRole("button", { name: "更多工具", exact: true });
  await expect(focusMore).toBeVisible();
  if (await focusMore.getAttribute("aria-expanded") === "true") await focusMore.click();
  await expect(tools).toHaveCount(0);
  await focusMore.click();
  await expect(tools).toBeVisible();
});

for (const origin of ["database", "local"] as const) test(`共享查找与块号跳转、非法输入校验：${origin}`, async ({ page }, testInfo) => {
  const root = await openReadonlyFixture(page, testInfo, origin);
  const tools = root.getByRole("toolbar", { name: "文档阅读工具", exact: true });
  // The same controlled find/jump surface is hosted by both source adapters.
  await tools.getByRole("button", { name: "文档查找", exact: true }).click();
  const find = root.getByRole("search", { name: "文档查找", exact: true });
  const query = find.getByRole("textbox", { name: "在当前文档中查找", exact: true });
  await query.fill("共同正文");
  await expect(find.getByRole("status")).toHaveText("0/1");
  await query.press("Enter");
  await expect(find.getByRole("status")).toHaveText("1/1");
  await find.getByRole("checkbox", { name: "正则表达式（Perl）", exact: true }).check();
  await query.fill("(");
  await expect(find.getByRole("alert")).toBeVisible();
  await expect(root.locator(".search-match-active")).toHaveCount(0);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+g" : "Control+g");
  await expect(find).toHaveCount(0);
  const jump = root.getByRole("dialog", { name: "跳转块", exact: true });
  await jump.getByRole("textbox", { name: "跳转到块号", exact: true }).fill("1.5");
  await jump.getByRole("button", { name: "跳转", exact: true }).click();
  await expect(jump.getByRole("status")).toHaveText("请输入 1–2 的块号");
  await jump.getByRole("textbox", { name: "跳转到块号", exact: true }).fill("2");
  await jump.getByRole("button", { name: "跳转", exact: true }).click();
  await expect(jump).toHaveCount(0);
  await tools.getByRole("button", { name: "文档查找", exact: true }).click();
  await find.locator(".editor-find-header").click({ position: { x: 8, y: 8 } });
  await page.keyboard.press("Escape");
  await expect(find).toHaveCount(0);
  if (origin === "local") await expect(page.getByRole("region", { name: "本地文件树" })).toBeVisible();
});

for (const origin of ["database", "local"] as const) test(`只读长章节从正文折叠使用相同视口锚点：${origin}`, async ({ page }, testInfo) => {
  const root = await openReadonlyFixture(page, testInfo, origin, true);
  if (origin === "local") await root.getByRole("button", { name: "设为只读", exact: true }).click();
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  const paragraph = root.locator(".ProseMirror p").filter({ hasText: /^章节正文 30$/ });
  await paragraph.scrollIntoViewIfNeeded();
  await root.locator(".ProseMirror").evaluate(element => {
    element.addEventListener("pointerup", event => { (element as HTMLElement).dataset.foldY = String((event as PointerEvent).clientY); }, { capture: true });
  });
  await paragraph.dblclick();
  const pointerY = Number(await root.locator(".ProseMirror").getAttribute("data-fold-y"));
  await expect(paragraph).toBeHidden();
  const heading = root.locator(".ProseMirror h1").filter({ hasText: "共同标题" });
  await expect.poll(async () => { const r = await heading.boundingBox(); return Math.abs(r!.y + r!.height / 2 - pointerY); }).toBeLessThan(24);
  await expect.poll(() => page.evaluate(() => document.getSelection()?.toString() ?? "")).toBe("");
  await heading.dblclick();
  await expect(paragraph).toBeVisible();
});
