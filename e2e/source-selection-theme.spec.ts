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
