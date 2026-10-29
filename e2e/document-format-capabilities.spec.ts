import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { openWritableLocalDirectory } from "./helpers/local-files";
import { replaceSource, selectDocumentLanguage, sourceInfo } from "./helpers/source-editor";

for (const local of [false, true]) test(`格式切换保留导航展开状态，Text 隐藏大纲，Markdown 恢复预览 local=${local}`, async ({ page }) => {
  await createBlankDocument(page);
  let host = page.locator(".markdown-document-view");
  const raw = "# Heading\n\nint main(void) { return 0; }\n";
  if (local) {
    const { workspace } = await openWritableLocalDirectory(page, { "view.md": raw }, "view.md");
    host = workspace;
  } else {
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await replaceSource(host.locator(".cm-content"), raw);
  }
  const format = async (value: string) => {
    await selectDocumentLanguage(page, value);
    await expect.poll(async () => (await sourceInfo(host.locator(".cm-content"))).value).toBe(raw);
  };
  const outline = () => host.locator('[data-document-panel-trigger="outline"]');
  await expect(outline()).toHaveAttribute("aria-label", local ? "目录" : "文档目录");
  await outline().click();
  await expect(outline()).toHaveAttribute("aria-pressed", "true");
  const width = await host.locator(".document-panel-dock").evaluate(el => el.getBoundingClientRect().width);
  await format("c");
  await expect(outline()).toHaveAttribute("aria-label", "源码符号");
  await expect(outline()).toHaveAttribute("aria-pressed", "true");
  await expect(host.getByRole("button", { name: "渲染", exact: true })).toHaveCount(0);
  await expect(host.locator(".document-outline-list")).toContainText("main");
  await format("");
  await expect(outline()).toHaveCount(0);
  await expect(host.locator(".document-panel-dock")).toHaveCount(0);
  await format("python");
  await expect(outline()).toHaveCount(0);
  await format("markdown");
  await expect(outline()).toHaveAttribute("aria-label", local ? "目录" : "文档目录");
  await expect(outline()).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => host.locator(".document-panel-dock").evaluate(el => el.getBoundingClientRect().width)).toBe(width);
  await expect(host.getByRole("button", { name: "渲染", exact: true })).toBeVisible();
  await host.getByRole("button", { name: "并排预览", exact: true }).click();
  await expect(host.locator(".markdown-preview-pane h1")).toHaveText("Heading");
  await host.getByRole("button", { name: "并排预览", exact: true }).click();
  await host.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(host.locator(".ProseMirror h1")).toHaveText("Heading");
});

test("磁盘汇编使用符号并可跳转，状态栏工具保持右对齐且插件下仍然有效", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await createBlankDocument(page);
  const raw = '.intel_syntax noprefix\n.global entry\nentry:\n nop\n.flush:\n ret\n.global finish\nfinish:\n ret\n';
  const { workspace } = await openWritableLocalDirectory(page, { "entry.S": raw }, "entry.S");
  await expect(workspace.getByRole("button", { name: "源码符号", exact: true })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "目录", exact: true })).toHaveCount(0);
  await workspace.getByRole("button", { name: "源码符号", exact: true }).click();
  const panel = workspace.getByRole("complementary", { name: "本地源码符号", exact: true });
  await expect(panel).toContainText("finish");
  await panel.getByRole("button", { name: /finish/ }).last().click();
  await expect.poll(async () => (await sourceInfo(workspace.locator(".cm-content"))).selectionStart).toBe(raw.indexOf("finish:"));
  const bar = workspace.getByRole("group", { name: "源码状态栏", exact: true });
  const aligned = async () => {
    const box = (await bar.boundingBox())!;
    const tools = (await bar.locator(".editor-status-source-controls").boundingBox())!;
    expect(tools.x).toBeGreaterThan(box.x);
    expect(tools.x + tools.width).toBeLessThanOrEqual(box.x + box.width);
    expect(box.x + box.width - tools.x - tools.width).toBeLessThan(30);
  };
  await aligned();
  await page.evaluate(async () => {
    const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    // Use the builtin presenter through its normal lifecycle.
    const { saveStatusPreference, readStatusPreference } = await import("/src/lib/plugin-system/builtin-status-display.ts");
    saveStatusPreference({ ...readStatusPreference(), enabled: true });
    setPluginsEnabled(true);
  });
  await expect(bar).toHaveAttribute("data-status-display", "plugin");
  await aligned();
});

test("只读源码改用 Markdown 查看时恢复目录、并排及渲染，不改写存储", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true })));
  await createBlankDocument(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const raw = "# Viewed as Markdown\n\ncontent\n";
  await replaceSource(page.locator(".cm-content"), raw);
  await selectDocumentLanguage(page, "c");
  await page.getByRole("button", { name: "设置只读", exact: true }).click();
  const stored = () => page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    return (await api.notes.get(localStorage.getItem("nr:lastNote")!))!.content;
  });
  await expect.poll(async () => (await stored()).metadata?.sourceLanguage).toBe("c");
  const before = await stored();
  await selectDocumentLanguage(page, "markdown");
  await expect(page.getByRole("button", { name: "源码符号", exact: true })).toHaveCount(0);
  const outline = page.getByRole("button", { name: "文档目录", exact: true });
  await outline.click();
  await expect(page.locator(".document-outline-list")).toContainText("Viewed as Markdown");
  await page.getByRole("button", { name: "并排预览", exact: true }).click();
  await expect(page.locator(".markdown-preview-pane h1")).toHaveText("Viewed as Markdown");
  await page.getByRole("button", { name: "并排预览", exact: true }).click();
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Viewed as Markdown");
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(page.locator(".cm-content"))).value).toBe(raw);
  expect(await stored()).toEqual(before);
  // A deliberate bookmark edit maps back to the original model, never saves
  // the temporary Markdown projection over the stored C source.
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await page.getByRole("button", { name: "第 1 块操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "添加块书签", exact: true }).click();
  await expect.poll(async () => (await stored()).metadata?.bookmarks?.length).toBe(1);
  const bookmarked = await stored();
  expect(bookmarked.ops).toEqual(before.ops);
  expect(bookmarked.metadata?.sourceText).toBe(raw);
  expect(bookmarked.metadata?.sourceLanguage).toBe("c");
  expect(bookmarked.metadata?.sourceFormat).toBe("text");
});
