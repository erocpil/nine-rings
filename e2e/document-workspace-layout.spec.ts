import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, sourceInfo } from "./helpers/source-editor";

for (const source of [false, true]) test(`文档两种布局独立保存面板状态，切换不重建编辑器：源码=${source}`, async ({ page }) => {
  await createBlankDocument(page, "布局模式");
  await page.locator(".ProseMirror:visible").evaluate(element => (element as any).editor.commands.setContent({ type: "doc", content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "章节一" }] },
    { type: "paragraph", content: [{ type: "text", text: "保留正文与撤销历史" }] },
  ] }, true));
  if (source) await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = source ? page.getByRole("textbox", { name: "Markdown 源码", exact: true }) : page.locator(".ProseMirror:visible");
  await expect(area).toBeVisible();
  if (source) await replaceSource(area, "# 章节一\n\n保留正文与撤销历史\n");
  await area.evaluate(element => { (window as any).workspaceEditorElement = element; });
  await page.evaluate(async () => {
    const { saveWorkspaceLayout } = await import("/src/lib/workspace-layout.ts");
    saveWorkspaceLayout({ outlinePinned: true, bookmarkPinned: true, panelWidth: 330 });
  });
  await expect(page.getByRole("navigation", { name: "文档目录", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "文档书签", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { saveDocumentWorkspaceMode } = await import("/src/lib/document-workspace-layout.ts");
    saveDocumentWorkspaceMode("database", "compact");
  });
  await expect(page.locator(".document-workspace-compact:visible")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "文档目录", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "文档目录", exact: true }).click();
  const outline = page.getByRole("navigation", { name: "文档目录", exact: true });
  await expect(outline).toBeVisible();
  const title = await page.locator(".note-title-row:visible").boundingBox();
  expect((await outline.boundingBox())!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
  await page.getByRole("button", { name: "文档书签", exact: true }).click();
  await expect(outline).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "文档书签", exact: true })).toBeVisible();
  await page.evaluate(async () => (await import("/src/lib/document-workspace-layout.ts")).saveDocumentWorkspaceMode("database", "document"));
  await expect(outline).toBeVisible();
  await expect(page.getByRole("navigation", { name: "文档书签", exact: true })).toBeVisible();
  expect(await area.evaluate(element => element === (window as any).workspaceEditorElement)).toBe(true);
  if (source) expect((await sourceInfo(area)).value).toContain("保留正文与撤销历史");
  else await expect(area).toContainText("保留正文与撤销历史");
});

test("本地 Markdown 可切换两种布局，并保留源码实例、书签和各布局状态", async ({ page }, testInfo) => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await createBlankDocument(page, "本地布局");
  await page.evaluate(async () => {
    const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    const { saveLocalFilesEnabled } = await import("/src/lib/plugin-system/builtin-local-files.ts");
    setPluginsEnabled(true); saveLocalFilesEnabled(true);
    Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
  });
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  const root = testInfo.outputPath("local-layout");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "layout.md"), "# 本地章节\n\n保留本地原文\n");
  const tree = page.getByRole("region", { name: "本地文件树" });
  await tree.locator("input[type=file]").setInputFiles(root);
  await tree.getByRole("button", { name: "layout.md", exact: true }).click();
  const viewer = page.getByRole("region", { name: "本地文件工作区" });
  const area = viewer.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await expect(area).toBeVisible();
  await area.evaluate(element => { (window as any).workspaceEditorElement = element; });
  await viewer.getByRole("button", { name: "目录", exact: true }).click();
  const outline = viewer.getByRole("navigation", { name: "本地文件目录", exact: true });
  await expect(outline).toBeVisible();
  await page.evaluate(async () => {
    const { saveDocumentWorkspaceMode } = await import("/src/lib/document-workspace-layout.ts");
    const { saveWorkspaceLayout } = await import("/src/lib/workspace-layout.ts");
    saveWorkspaceLayout({ outlinePinned: false, bookmarkPinned: false, panelsSide: "left" });
    saveDocumentWorkspaceMode("local", "document");
  });
  await expect(outline).toHaveCount(0);
  await viewer.getByRole("button", { name: "目录", exact: true }).click();
  await viewer.getByRole("button", { name: "书签", exact: true }).click();
  await expect(outline).toBeVisible();
  await expect(viewer.getByRole("complementary", { name: "本地文件书签", exact: true })).toBeVisible();
  await expect(viewer.locator(".document-panel-dock")).toHaveClass(/dock-left/);
  await page.evaluate(async () => (await import("/src/lib/document-workspace-layout.ts")).saveDocumentWorkspaceMode("local", "compact"));
  await expect(outline).toBeVisible();
  await expect(viewer.getByRole("complementary", { name: "本地文件书签", exact: true })).toHaveCount(0);
  await expect(viewer.locator(".document-panel-dock")).toHaveClass(/dock-right/);
  expect(await area.evaluate(element => element === (window as any).workspaceEditorElement)).toBe(true);
  expect((await sourceInfo(area)).value).toBe("# 本地章节\n\n保留本地原文\n");
  await viewer.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(viewer.locator(".markdown-reading-view h1")).toHaveText("本地章节");
  await expect(viewer.getByRole("navigation", { name: "文档目录", exact: true })).toBeVisible();
});
