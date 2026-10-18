import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

for (const source of [false, true]) {
  test(`目录展示插件共享排版、定位与停用回退：源码=${source}`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("nr:pluginsEnabled", "true");
      localStorage.setItem("nr:pluginOutlineDisplay", JSON.stringify({ enabled: true, display: {
        target: "document-outline", font: "mono", fontSize: 18, rowHeight: 42,
        labelColor: "secondary", tooltip: "path", showCounts: false, showMetadata: false,
        toolbar: ["outline.reveal-current"],
      } }));
    });
    await createBlankDocument(page);
    await page.locator(".ProseMirror").evaluate(element => {
      const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      editor.commands.setContent({ type: "doc", content: Array.from({ length: 140 }, (_, index) => ({
        type: "heading", attrs: { level: index === 0 ? 1 : 2 },
        content: [{ type: "text", text: index === 0 ? "父章节" : `子章节 ${index}` }],
      })) }, true);
    });
    if (source) await page.getByRole("button", { name: "源码", exact: true }).click();
    await page.getByRole("button", { name: "文档目录", exact: true }).click();
    const panel = page.getByRole("navigation", { name: "文档目录", exact: true });
    if (source) await expect(panel).toHaveAttribute("aria-busy", "false");
    const list = panel.locator(".document-outline-list");
    await expect(list).toHaveAttribute("data-panel-display", "plugin");
    await expect(list.locator(".document-outline-level")).toHaveCount(0);
    await expect(panel.locator(".document-outline-count")).toHaveCount(0);
    await panel.getByRole("button", { name: "全部展开", exact: true }).click();
    await panel.getByRole("button", { name: "滚动至顶部", exact: true }).click();
    const row = list.locator('[data-outline-index="1"]');
    await expect(row.locator(".document-outline-text")).toHaveCSS("font-size", "18px");
    await expect(row).toHaveAttribute("title", "父章节 / 子章节 1");
    expect(await row.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(42);
    await panel.getByRole("button", { name: "滚动至底部", exact: true }).click();
    await expect(list.locator('[data-outline-index="139"]')).toBeVisible();
    expect(await list.locator(".document-outline-item").count()).toBeLessThan(80);
    await panel.getByRole("button", { name: "定位当前标题", exact: true }).click();
    await expect(list.locator(".document-outline-item.current")).toBeVisible();
    await page.evaluate(async () => {
      const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
      setPluginsEnabled(false);
    });
    await expect(list).not.toHaveAttribute("data-panel-display", "plugin");
    await expect(panel.getByRole("button", { name: "定位当前标题", exact: true })).toHaveCount(0);
    await expect(list.locator(".document-outline-level").first()).toBeVisible();
  });
}

test("目录展示配置入口与独立开关", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nr:pluginsEnabled", "true"));
  await page.goto("/");
  await page.keyboard.press("Alt+,");
  await page.getByLabel("设置分类").getByRole("button", { name: /^高级/ }).click();
  await page.getByRole("checkbox", { name: "启用目录展示", exact: true }).check();
  await page.getByRole("button", { name: "目录展示", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "目录展示配置", exact: true });
  await dialog.getByRole("spinbutton", { name: "目录字号", exact: true }).fill("17");
  await expect(dialog.getByRole("status")).toContainText("已更新");
  await dialog.getByRole("button", { name: "恢复目录展示默认设置", exact: true }).click();
  await expect(dialog.getByRole("spinbutton", { name: "目录字号", exact: true })).toHaveValue("13");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "启用目录展示", exact: true })).toBeChecked();
});

test("手机局部只读目录沿用展示配置并可停用回退", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nr:pluginsEnabled", "true");
    localStorage.setItem("nr:pluginOutlineDisplay", JSON.stringify({ enabled: true, display: {
      target: "document-outline", font: "mono", fontSize: 18, rowHeight: 28,
      labelColor: "secondary", tooltip: "path", showCounts: true, showMetadata: true,
      toolbar: ["outline.reveal-current"],
    } }));
  });
  await createBlankDocument(page);
  await page.locator(".ProseMirror").fill("目录试点");
  await page.locator(".ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [1, 2].map(level => ({ type: "heading", attrs: { level }, content: [{ type: "text", text: `章节 ${level}` }] })) }, true);
  });
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  await page.evaluate(() => {
    localStorage.setItem("nr:experimentalReadonlyRendering", "true");
    window.dispatchEvent(new Event("nine-rings:readonly-rendering-change"));
  });
  await expect(page.locator("[data-virtual-reader]")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".sidebar-tab-hide").click();
  await page.getByRole("button", { name: "文档目录", exact: true }).click();
  const drawer = page.locator(".vr-panel[data-document-kind=outline]");
  const row = drawer.locator(".vr-outline-row").last();
  await expect(row).toHaveAttribute("data-panel-display", "plugin");
  await expect(row).toHaveAttribute("title", "章节 1 / 章节 2");
  await expect(row).toHaveCSS("font-size", "18px");
  expect(await row.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(36);
  await expect(drawer.getByRole("button", { name: "定位当前标题", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    setPluginsEnabled(false);
  });
  await expect(row).not.toHaveAttribute("data-panel-display", "plugin");
  await expect(drawer.locator(".document-outline-level")).toHaveCount(0);
});
