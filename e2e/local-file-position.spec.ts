import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";

for (const readonly of [false, true]) test(`本地文件切换保留最新纵横滚动位置，含无内存缓存恢复 readonly=${readonly}`, async ({ page }, testInfo) => {
  await createBlankDocument(page, "本地阅读位置回归");
  await closeDocumentSidebar(page);
  await page.evaluate(async () => {
    const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    const { saveLocalFilesEnabled } = await import("/src/lib/plugin-system/builtin-local-files.ts");
    const { saveBlockWorkspacePreferences } = await import("/src/lib/block-display-settings.ts");
    saveBlockWorkspacePreferences({ wrap: false });
    setPluginsEnabled(true); saveLocalFilesEnabled(true);
    Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
  });
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  const panel = page.getByRole("region", { name: "本地文件树" });
  const dir = testInfo.outputPath("position");
  await mkdir(dir, { recursive: true });
  for (const name of ["a.c", "b.c"])
    await writeFile(join(dir, name), Array.from({ length: 500 }, (_, i) => `// ${name} line ${i + 1} ${"content ".repeat(45)}`).join("\n"));
  await panel.locator("input[type=file]").setInputFiles(dir);
  const file = (name: string) => panel.locator(".local-file-row").filter({ has: page.locator(".local-file-name", { hasText: name }) });
  if (readonly) {
    await panel.locator(".local-file-root .local-file-row").click({ button: "right" });
    await page.getByRole("menuitem", { name: "设为只读", exact: true }).click();
  }
  const viewer = page.getByRole("region", { name: "本地文件工作区" });
  const scroller = viewer.locator(".cm-scroller");
  let useTabs = false;
  const open = async (name: string) => {
    if (useTabs) await page.getByRole("tablist", { name: "最近文档", exact: true }).getByRole("tab", { name, exact: true }).click();
    else await file(name).click();
    await expect(viewer.locator(".local-file-titlebar .note-title")).toHaveText(name);
    await expect(scroller).toBeVisible();
    await scroller.evaluate(async element => {
      await document.fonts.ready;
      const { EditorView } = await import("/node_modules/@codemirror/view/dist/index.js");
      const view = EditorView.findFromDOM(element)!;
      await new Promise<void>(resolve => view.requestMeasure({ read: () => view.contentHeight, write: () => resolve() }));
    });
  };
  await open("a.c");
  await open("b.c");
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  useTabs = true;
  await open("a.c");
  const scroll = async (top: number, left: number) => {
    await scroller.evaluate((element, position) => { element.scrollTop = position.top; element.scrollLeft = position.left; }, { top, left });
    await expect.poll(() => scroller.evaluate(element => Math.round(element.scrollTop))).toBe(top);
    await expect.poll(() => page.evaluate(() => {
      const values = Object.entries(JSON.parse(localStorage.getItem("nr:local-file-positions") ?? "{}")) as Array<[string, { scrollTop: number; scrollLeft: number }]>;
      return values.find(([id]) => id.endsWith(":a.c"))?.[1];
    })).toMatchObject({ scrollTop: top, scrollLeft: left });
  };
  await scroll(1800, 120);
  await open("b.c");
  // Cleanup of the old editor must not replace its saved position with zero.
  await expect.poll(() => page.evaluate(() => Object.entries(JSON.parse(localStorage.getItem("nr:local-file-positions") ?? "{}")).find(([id]) => id.endsWith(":a.c"))?.[1])).toMatchObject({ scrollTop: 1800, scrollLeft: 120 });
  await open("a.c");
  await expect.poll(() => scroller.evaluate(element => Math.round(element.scrollTop))).toBe(1800);
  await expect.poll(() => scroller.evaluate(element => Math.round(element.scrollLeft))).toBe(120);
  await scroll(2800, 200);
  await open("b.c");
  await page.evaluate(async () => {
    const { clearLocalFileSessions } = await import("/src/lib/local-files/session.ts");
    clearLocalFileSessions();
  });
  await open("a.c");
  await expect.poll(() => scroller.evaluate(element => Math.round(element.scrollTop))).toBe(2800);
  await expect.poll(() => scroller.evaluate(element => Math.round(element.scrollLeft))).toBe(200);
  const tabs = page.getByRole("tablist", { name: "最近文档", exact: true });
  await tabs.getByRole("tab", { name: "本地阅读位置回归", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.locator("input.note-title:visible")).toHaveValue("本地阅读位置回归");
  await expect(tabs.getByRole("tab", { name: "a.c", exact: true })).toHaveAttribute("aria-selected", "false");
  await open("a.c");
  await expect(viewer).toBeVisible();
  await expect.poll(() => scroller.evaluate(element => Math.round(element.scrollTop))).toBe(2800);
});
