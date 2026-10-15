import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, selectSource, sourceInfo } from "./helpers/source-editor";

test("所有风格源码聚焦/失焦选区使用柔和主题背景，保持编辑和撤销", async ({ page }) => {
  await createBlankDocument(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  const text = "# 标题\n\n正文 selection 123";
  await replaceSource(area, text);
  const styles = await page.evaluate(async () => {
    const { INTERFACE_STYLES } = await import("/src/lib/interface-style.ts");
    return INTERFACE_STYLES.map(style => style.value);
  });
  for (const style of styles) for (const mode of ["dark", "light"] as const) {
    await page.evaluate(async ({ style, mode }) => {
      const { applyInterfaceAppearance } = await import("/src/lib/interface-style.ts");
      applyInterfaceAppearance({ interface_style: style, interface_color_mode: mode, theme: mode });
    }, { style, mode });
    await area.focus();
    await selectSource(area, text.indexOf("正文"), text.length);
    const selection = page.locator(".markdown-cm-host .cm-selectionBackground").last();
    await expect(selection).toBeVisible();
    for (const focused of [true, false]) {
      if (!focused) await page.getByRole("button", { name: "渲染", exact: true }).focus();
      const alpha = await selection.evaluate(el => {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.fillStyle = getComputedStyle(el).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return context.getImageData(0, 0, 1, 1).data[3] / 255;
      });
      expect(alpha, `${style}/${mode}/focused=${focused}`).toBeCloseTo(mode === "dark" ? .16 : .20, 2);
    }
  }
  await area.focus();
  await page.keyboard.insertText("修改");
  expect((await sourceInfo(area)).value).toContain("修改");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(text);
});

test("各风格插入光标区别于文字与强调色，并与背景保持对比", async ({ page }) => {
  await createBlankDocument(page);
  const editor = page.locator(".ProseMirror:visible");
  await editor.fill("光标测试");
  const styles = await page.evaluate(async () => (await import("/src/lib/interface-style.ts")).INTERFACE_STYLES.map(style => style.value));
  for (const style of styles) for (const mode of ["light", "dark"] as const) {
    await page.evaluate(async ({ style, mode }) => {
      (await import("/src/lib/interface-style.ts")).applyInterfaceAppearance({ interface_style: style, interface_color_mode: mode, theme: mode });
    }, { style, mode });
    const colors = await editor.evaluate(el => {
      const css = getComputedStyle(el);
      const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d")!;
      const rgb = (color: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3); };
      const caret = rgb(css.caretColor), background = rgb(css.getPropertyValue("--bg"));
      const luminance = (values: number[]) => values.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const a = luminance(caret), b = luminance(background);
      return { caret, text: rgb(css.color), accent: rgb(css.getPropertyValue("--accent")), contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), css: css.caretColor };
    });
    expect(colors.caret, `${style}/${mode}`).not.toEqual(colors.text);
    expect(colors.caret).not.toEqual(colors.accent);
    expect(colors.contrast).toBeGreaterThanOrEqual(3);
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
    await source.focus();
    // CodeMirror hides the native caret and draws its own cursor layer.
    await expect(page.locator(".markdown-cm-host .cm-cursor").first()).toHaveCSS("border-left-color", colors.css);
    await page.getByRole("button", { name: "渲染", exact: true }).click();
  }
});
