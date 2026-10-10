import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, selectSource, sourceInfo } from "./helpers/source-editor";

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
    await expect.poll(async () => (await search.boundingBox())!.y + (await search.boundingBox())!.height - (await page.locator(".markdown-cm-host .cm-scroller").boundingBox())!.y).toBeLessThanOrEqual(1);
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
    await area.press("Meta+g");
    await expect(form).toBeVisible();
    await input.press("Meta+g");
    await expect(form).toHaveCount(0);
    await area.press("Meta+g");
    await input.press("Escape");
    await expect(form).toHaveCount(0);
    expect((await sourceInfo(area)).value).toBe(text);
    await page.screenshot({ path: test.info().outputPath("source-toolbar.png") });
  });
}

test("源码常用格式操作单步撤销，只读禁用写入而保留折叠", async ({ page }) => {
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
    await expect(toolbar.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await expect(toolbar.getByRole("button", { name: "折叠全部", exact: true })).toBeEnabled();
});
