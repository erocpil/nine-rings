import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, selectSource, sourceInfo } from "./helpers/source-editor";

for (const width of [390, 1440]) {
  test(`源码微渲染保留字符、选择和撤销，行号小于正文并保持对齐 ${width}`, async ({ page }) => {
    await page.addInitScript(width => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true, theme: width === 1440 ? "dark" : "light" })), width);
    await createBlankDocument(page, "微渲染验证");
    await page.setViewportSize({ width, height: 1000 });
    if (width === 390) await page.getByRole("button", { name: "隐藏侧栏", exact: true }).click();
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
    const toggle = page.getByRole("button", { name: "源码微渲染", exact: true });
    const text = "# 一级 **强调**\n\n## 二级\n\n### 三级\n\n#### 四级\n\n正文 [链接](https://example.com) 与 `代码`\n\n- [ ] 任务\n\n> 引用\n\n```text\n# 这不是标题\n```";
    await replaceSource(area, text);
    await selectSource(area, text.indexOf("正文"), text.indexOf("正文") + 2);
    const before = await sourceInfo(area);
    const body = page.locator(".cm-line").filter({ hasText: /^正文 / });
    const baseSize = await body.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const heading = area.locator(".source-micro-h1").first();
    await expect.poll(() => heading.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(baseSize * 1.25, 1);
    const unchanged = await sourceInfo(area);
    expect(unchanged.value).toBe(text);
    expect([unchanged.selectionStart, unchanged.selectionEnd]).toEqual([before.selectionStart, before.selectionEnd]);
    await expect(area.locator(".source-micro-link").filter({ hasText: "https://example.com" })).toHaveCSS("text-decoration-line", "underline");
    const listMark = area.locator(".cm-line").filter({ hasText: /^- \[ \] 任务$/ }).locator(".source-micro-marker").first();
    await expect(listMark).toHaveText("-");
    await expect(listMark).toHaveCSS("font-weight", "600");
    await expect(area.locator(".source-micro-marker").filter({ hasText: /^>$/ })).toHaveCount(1);
    const code = page.locator(".cm-line").filter({ hasText: /^# 这不是标题$/ });
    await expect(code.locator(".source-micro-h1")).toHaveCount(0);
    const gutter = page.locator(".cm-lineNumbers .cm-gutterElement").filter({ hasText: /^1$/ });
    await expect(gutter).toBeVisible();
    expect(await gutter.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThan(baseSize);
    expect(await gutter.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(16);
    const line = page.locator(".cm-line").filter({ hasText: /^# 一级/ });
    await expect.poll(async () => Math.abs((await gutter.boundingBox())!.y - (await line.boundingBox())!.y)).toBeLessThan(2);
    await page.screenshot({ path: test.info().outputPath("source-micro.png"), animations: "disabled" });
    // Display toggles must not consume undo steps or replace the editor instance.
    await page.getByRole("button", { name: "加粗", exact: true }).click();
    await expect.poll(async () => (await sourceInfo(area)).value).toContain("**正文**");
    await toggle.click();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect.poll(async () => (await sourceInfo(area)).value).toBe(text);
    await expect.poll(() => heading.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBe(baseSize);
    await toggle.click();
    await page.getByRole("button", { name: "渲染", exact: true }).click();
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
}
