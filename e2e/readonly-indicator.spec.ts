import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

for (const virtual of [false, true]) test(`只读与编辑状态图标跨视图和主题保持语义颜色 virtual=${virtual}`, async ({ page }) => {
  await page.addInitScript(virtual => localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual)), virtual);
  await createBlankDocument(page);
  await page.locator(".ProseMirror:visible").fill("状态测试");
  for (const mode of ["light", "dark"] as const) {
    await page.evaluate(async mode => {
      (await import("/src/lib/interface-style.ts")).applyInterfaceAppearance({ interface_style: "calm", interface_color_mode: mode, theme: mode });
    }, mode);
    const green = mode === "light" ? "rgb(35, 120, 71)" : "rgb(131, 196, 155)";
    const orange = mode === "light" ? "rgb(168, 98, 9)" : "rgb(242, 180, 94)";
    const state = page.locator("[data-document-readonly]:visible");
    await expect(state.locator(".toolbar-icon")).toHaveCSS("color", green);
    await state.click();
    await expect(state).toHaveAttribute("data-document-readonly", "true");
    await expect(state.locator(".toolbar-icon")).toHaveCSS("color", orange);
    await state.hover();
    await expect(state.locator(".toolbar-icon")).toHaveCSS("color", orange);
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(state.locator(".toolbar-icon")).toHaveCSS("color", orange);
    await state.click();
    await expect(state).toHaveAttribute("data-document-readonly", "false");
    await expect(state.locator(".toolbar-icon")).toHaveCSS("color", green);
    await page.getByRole("button", { name: "渲染", exact: true }).click();
    await expect(state.locator(".toolbar-icon")).toHaveCSS("color", green);
  }
});
