import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, selectSource, sourceInfo, selectDocumentLanguage } from "./helpers/source-editor";

const jumpShortcut = process.platform === "darwin" ? "Meta+g" : "Control+g";

for (const width of [900, 1440]) {
  for (const language of ["markdown", "c"]) {
    test(`源码标题按钮与内置插件尺寸一致 ${width} ${language}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_status_bar: false })));
      await createBlankDocument(page);
      await page.evaluate(async () => (await import("/src/lib/plugin-system/runtime.ts")).setPluginsEnabled(true));
      if (language === "markdown") await page.getByRole("button", { name: "源码", exact: true }).click();
      else await selectDocumentLanguage(page, language);
      const row = page.locator(".markdown-source-title-row");
      const plugin = row.getByRole("button", { name: "内置插件", exact: true });
      await expect(plugin).toBeVisible();
      const reference = (await plugin.boundingBox())!;
      const buttons = row.locator(".markdown-view-toggle, [data-document-panel-trigger], .document-navigation > button");
      expect(await buttons.count()).toBeGreaterThanOrEqual(5);
      for (const button of await buttons.all()) {
        const bounds = (await button.boundingBox())!;
        expect(bounds.width).toBeCloseTo(reference.width, 1);
        expect(bounds.height).toBeCloseTo(reference.height, 1);
      }
    });
  }
}

for (const width of [390, 1440]) {
  test(`源码顶部工具面板互斥、按钮收回及跳转校验 ${width}`, async ({ page }) => {
    await page.addInitScript(width => localStorage.setItem("nine_rings_config", JSON.stringify({ theme: width === 1440 ? "dark" : "light", interface_style: "paper", interface_color_mode: width === 1440 ? "dark" : "light" })), width);
    await createBlankDocument(page);
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) await page.getByRole("button", { name: "隐藏侧栏", exact: true }).click();
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
    const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    await replaceSource(area, text);
    const toolbar = page.getByRole("toolbar", { name: "源码编辑工具" });
    const find = toolbar.getByRole("button", { name: "查找替换", exact: true });
    const jump = toolbar.getByRole("button", { name: "跳转行", exact: true });
    const viewport = page.locator(".markdown-cm-host .cm-scroller");
    const initialViewport = await viewport.boundingBox();
    await find.click();
    await expect(find).toHaveAttribute("aria-expanded", "true");
    const search = page.getByRole("search", { name: "源码查找与替换" });
    await expect(search).toBeVisible();
    await search.getByRole("textbox", { name: "查找", exact: true }).fill("line");
    await expect(search.locator(".editor-find-count")).toHaveText("100 处");
    const panelColor = await search.evaluate(el => getComputedStyle(el).backgroundColor);
    await expect.poll(async () => (await viewport.boundingBox())!.y).toBeCloseTo(initialViewport!.y, 0);
    await expect.poll(async () => (await viewport.boundingBox())!.height).toBeCloseTo(initialViewport!.height, 0);
    await page.screenshot({ path: test.info().outputPath("source-search.png") });
    await find.click();
    await expect(search).toHaveCount(0);
    await expect(find).toHaveAttribute("aria-expanded", "false");
    await find.click();
    await expect(search.getByRole("textbox", { name: "查找", exact: true })).toHaveValue("line");
    await jump.click();
    await expect(search).toHaveCount(0);
    const form = page.getByRole("form", { name: "源码跳转行" });
    await expect(form).toBeVisible();
    await expect(form).toHaveCSS("background-color", panelColor);
    await expect(jump).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => (await viewport.boundingBox())!.height).toBeCloseTo(initialViewport!.height, 0);
    await expect.poll(async () => (await viewport.boundingBox())!.y).toBeCloseTo(initialViewport!.y, 0);
    await expect.poll(async () => (await form.boundingBox())!.y - initialViewport!.y).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath("source-jump.png") });
    const input = form.getByRole("textbox", { name: "行号或位置" });
    await input.fill("oops");
    await input.press("Enter");
    await expect(form.getByRole("alert")).toBeVisible();
    await input.fill("50:2");
    await input.press("Enter");
    await expect(form).toHaveCount(0);
    expect((await sourceInfo(area)).selectionStart).toBe(text.indexOf("line 50") + 2);
    await jump.click();
    await jump.click();
    await expect(form).toHaveCount(0);
    await area.press(jumpShortcut);
    await expect(form).toBeVisible();
    await input.press(jumpShortcut);
    await expect(form).toHaveCount(0);
    await area.press(jumpShortcut);
    await input.press("Escape");
    await expect(form).toHaveCount(0);
    expect((await sourceInfo(area)).value).toBe(text);
    await page.screenshot({ path: test.info().outputPath("source-toolbar.png") });
  });
}

test("源码常用格式操作单步撤销，只读隐藏写入而保留折叠", async ({ page }) => {
  await createBlankDocument(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  const toolbar = page.getByRole("toolbar", { name: "源码编辑工具" });
  for (const [button, expected] of [["斜体", "*hello*"], ["删除线", "~~hello~~"], ["引用", "> hello"], ["无序列表", "- hello"], ["有序列表", "1. hello"], ["待办列表", "- [ ] hello"]]) {
    await replaceSource(area, "hello");
    await selectSource(area, 0, 5);
    await toolbar.getByRole("button", { name: button, exact: true }).click();
    await expect.poll(async () => (await sourceInfo(area)).value).toBe(expected);
    await toolbar.getByRole("button", { name: "撤销", exact: true }).click();
    await expect.poll(async () => (await sourceInfo(area)).value).toBe("hello");
  }
  await selectSource(area, 0, 5);
  await toolbar.getByRole("button", { name: "代码块", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("```\nhello\n```\n");
  await toolbar.getByRole("button", { name: "折叠全部", exact: true }).click();
  await expect(page.locator(".cm-foldPlaceholder")).toBeVisible();
  await toolbar.getByRole("button", { name: "展开全部", exact: true }).click();
  await expect(page.locator(".cm-foldPlaceholder")).toHaveCount(0);
  await page.getByRole("button", { name: "设置只读", exact: true }).click();
  for (const name of ["斜体", "删除线", "引用", "无序列表", "有序列表", "待办列表", "代码块", "表格", "分隔线", "增加缩进", "减少缩进"]) {
    await expect(toolbar.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await expect(toolbar.getByRole("button", { name: "折叠全部", exact: true })).toBeEnabled();
  const names = await toolbar.getByRole("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")));
  const micro = names.indexOf("源码微渲染");
  expect(names.slice(micro + 1, micro + 5)).toEqual(["折叠全部", "选择折叠标题级别", "展开全部", "选择展开标题级别"]);
  await toolbar.getByRole("button", { name: "查找替换", exact: true }).click();
  await expect(page.getByRole("search", { name: "源码查找与替换" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "替换为", exact: true })).toBeHidden();
});

test("专注模式只读源码可用更多工具，和编辑视图共享展开状态", async ({ page }) => {
  await createBlankDocument(page, "只读源码更多工具");
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const tools = page.getByRole("button", { name: "更多工具", exact: true });
  const sourceToolbar = page.locator(".markdown-source-toolbar-host");
  await expect(tools).toBeVisible();
  await expect(tools).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "设置只读", exact: true }).click();
  await expect(sourceToolbar).toBeHidden();

  await tools.click();
  await expect(tools).toHaveAttribute("aria-expanded", "true");
  await expect(sourceToolbar).toBeVisible();
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(tools).toHaveAttribute("aria-expanded", "true");
  await expect(sourceToolbar).toBeVisible();

  await tools.click();
  await expect(tools).toHaveAttribute("aria-expanded", "false");
  await expect(sourceToolbar).toBeHidden();
});
