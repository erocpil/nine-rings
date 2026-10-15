import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

for (const virtual of [false, true]) test(`近黑粘贴文字适配明暗主题且保留颜色数据 virtual=${virtual}`, async ({ page }) => {
  await page.addInitScript(virtual => {
    localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual));
  }, virtual);
  await createBlankDocument(page);
  const editor = page.locator('.ProseMirror[contenteditable="true"]:visible');
  const original = await editor.evaluate(element => {
    const instance = (element as any).editor;
    instance.commands.setContent({ type: "doc", content: [
      { type: "paragraph", content: [
        { type: "text", text: "fixed ink", marks: [{ type: "textStyle", attrs: { color: "rgb(10, 27, 39)" } }] },
        { type: "text", text: " normal " },
        { type: "text", text: "red ink", marks: [{ type: "textStyle", attrs: { color: "#b43d28" } }] },
      ] },
      { type: "paragraph", content: [{ type: "text", text: "a", marks: [{ type: "textStyle", attrs: { color: "rgb(10, 27, 39)" } }] }] },
    ] }, true);
    return instance.getJSON();
  });
  for (const readonly of [false, true]) {
    if (readonly) await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    for (const mode of ["dark", "light"] as const) {
      await page.evaluate(async mode => {
        (await import("/src/lib/interface-style.ts")).applyInterfaceAppearance({ interface_style: "calm", interface_color_mode: mode, theme: mode });
      }, mode);
      const expected = mode === "dark" ? await page.evaluate(() => { const probe = document.createElement("span"); probe.style.color = "var(--text)"; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }) : "rgb(10, 27, 39)";
      await expect(page.getByText("fixed ink", { exact: true })).toHaveCSS("color", expected);
      await expect(page.getByText("a", { exact: true })).toHaveCSS("color", expected);
      await expect(page.getByText("red ink", { exact: true })).toHaveCSS("color", "rgb(180, 61, 40)");
    }
  }
  await page.getByRole("button", { name: virtual ? "设为可编辑" : "点击设为可编辑", exact: true }).click();
  await expect(editor).toBeVisible();
  expect(await editor.evaluate(el => (el as any).editor.getJSON())).toEqual(original);
  const roundtrip = await editor.evaluate(el => {
    const instance = (el as any).editor;
    instance.commands.setContent(instance.getHTML(), true);
    return instance.getJSON();
  });
  expect(roundtrip).toEqual(original);
});
