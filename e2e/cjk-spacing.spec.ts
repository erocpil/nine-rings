import { expect, test, type Locator } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

async function width(element: Locator) {
  return element.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().width;
  });
}

for (const fallback of [false, true]) {
  test(`中英文视觉间距：设置、正文、只读与并排预览 ${fallback ? "兼容" : "原生"}`, async ({ page }) => {
    if (fallback) await page.addInitScript(() => {
      // Simulate a WebView that parses the property but does not implement native spacing.
      const style = document.createElement("style");
      style.textContent = "* { text-autospace: no-autospace !important; }";
      document.addEventListener("DOMContentLoaded", () => document.head.append(style));
    });
    await createBlankDocument(page, "中英文间距回归");
    await page.evaluate(async () => {
      const { api } = await import("/src/lib/api.ts");
      await api.config.set({ interface_style: "calm", editor_cjk_spacing: true });
    });
    await page.reload();
    const editor = page.locator(".ProseMirror:visible").first();
    await expect(editor).toBeVisible();
    await editor.evaluate(element => {
      (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.commands.setContent(
        "<p>停用queue并确认设备DMA哪些host内存第3章</p><p><code>停用queue并确认</code></p>", true);
    });
    await waitForSavedText(page, "停用queue");
    const plain = editor.locator("p").first();
    const original = await plain.textContent();
    const enabledWidth = await width(plain);
    const codeWidth = await width(editor.locator("code"));
    await page.getByTitle("设置").click();
    await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
    await page.getByRole("button", { name: /打开排版设置/ }).click();
    const toggle = page.getByLabel("中英文自动间距", { exact: true });
    await expect(toggle.locator("..")).toBeVisible();
    await expect(toggle).toBeChecked();
    await toggle.locator("..").click();
    await page.getByRole("button", { name: "应用到编辑器", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect.poll(() => width(plain)).toBeLessThan(enabledWidth - 4);
    expect(await width(editor.locator("code"))).toBeCloseTo(codeWidth, 1);
    await expect(plain).toHaveText(original!);
    const disabledWidth = await width(plain);
    await page.reload();
    await expect.poll(() => width(plain)).toBeCloseTo(disabledWidth, 1);
    await page.evaluate(async () => {
      const { api } = await import("/src/lib/api.ts");
      await api.config.set({ editor_cjk_spacing: true });
      localStorage.setItem("nr:experimentalReadonlyRendering", "true");
    });
    await page.reload();
    await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    const readonly = page.locator(".vr-block p").first();
    await expect(readonly).toHaveText(original!);
    await expect.poll(() => width(readonly)).toBeCloseTo(enabledWidth, 0);
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await page.getByRole("button", { name: "并排预览", exact: true }).click();
    const preview = page.locator(".markdown-preview-scroll .ProseMirror p").first();
    await expect(preview).toHaveText(original!);
    await expect.poll(() => width(preview)).toBeCloseTo(enabledWidth, 0);
  });
}

test("旧 WebView 大文档仅为可视区域补充中英文间距，滚动后继续生效", async ({ page }) => {
  await page.addInitScript(() => {
    const original = CSS.supports.bind(CSS);
    CSS.supports = ((property: string, value?: string) => property === "text-autospace"
      ? false : value === undefined ? original(property) : original(property, value)) as typeof CSS.supports;
  });
  await createBlankDocument(page, "大文档中英文间距");
  const editor = page.locator(".ProseMirror:visible").first();
  await editor.evaluate(element => {
    (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.commands.setContent({
      type: "doc",
      content: Array.from({ length: 700 }, (_, i) => ({
        type: "paragraph", content: [{ type: "text", text: `第${i}段` + "中文queue第3章".repeat(20) }],
      })),
    }, true);
  });
  await expect(editor.locator("p").first().locator("[data-cjk-auto-space]")).not.toHaveCount(0);
  expect(await editor.locator("[data-cjk-auto-space]").count()).toBeLessThan(10000);
  const last = editor.locator("p").last();
  await last.scrollIntoViewIfNeeded();
  await expect(last.locator("[data-cjk-auto-space]")).not.toHaveCount(0);
  await expect(editor.locator("p").first().locator("[data-cjk-auto-space]")).toHaveCount(0);
});
