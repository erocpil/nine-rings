import { expect, test } from "@playwright/test";
import { createBlankDocument } from "../helpers/document";

test("渲染工具栏横线与标题对齐，首个插入按钮不被工具栏遮挡", async ({ page }) => {
  await createBlankDocument(page);
  await page.locator(".ProseMirror").fill("First paragraph");
  const editor = page.locator(".note-editor").filter({ has: page.locator(".ProseMirror") }).first();
  const more = editor.getByRole("button", { name: "更多工具", exact: true });
  if (await more.getAttribute("aria-expanded") !== "true") await more.click();
  const toolbar = editor.locator(".document-editing-tools");
  await expect(toolbar).toBeVisible();
  await expect(editor.locator(".editor-save-state-saved")).toBeVisible();
  await expect(toolbar.locator(".save-status-saved")).toHaveCount(0);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 850 });
    for (const style of ["classic", "calm", "paper", "minimal", "nine-rings", "mono-aware", "yugen", "wabi-sabi"]) {
      await page.evaluate(style => document.documentElement.dataset.interfaceStyle = style, style);
      await expect(toolbar).toHaveCSS("background-size", "100% 1px");
      await expect.poll(async () => {
        const title = (await editor.locator(".document-title-bar").boundingBox())!;
        const tools = (await toolbar.boundingBox())!;
        const inset = await editor.evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue("--document-edge-inset")));
        return Math.max(Math.abs(tools.x - title.x - inset), Math.abs(tools.x + tools.width - title.x - title.width + inset));
      }, { message: `${style} at ${width}: toolbar rule matches title rule` }).toBeLessThan(2);
    }
  }
  await page.setViewportSize({ width: 1280, height: 850 });
  const insert = editor.locator(".editor-block-insert").first();
  await expect(insert).toBeAttached();
  await expect.poll(async () => {
    const button = (await insert.boundingBox())!, tools = (await toolbar.boundingBox())!;
    return button.y - tools.y - tools.height;
  }).toBeGreaterThanOrEqual(0);
});

test("非经典桌面风格的只读标题悬停不填充背景", async ({ page }) => {
  await createBlankDocument(page);
  await page.locator(".ProseMirror").fill("Readonly document");
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  const title = page.locator(".document-title-bar .note-title");
  await expect(title).toBeVisible();
  for (const style of ["classic", "calm", "calm-compact", "paper", "minimal", "nine-rings", "mono-aware", "yugen", "wabi-sabi"]) {
    await page.evaluate(style => {
      document.documentElement.dataset.interfaceStyle = style;
      document.querySelector(".app")?.classList.add("app-desktop-workspace");
    }, style);
    await title.hover({ position: { x: 10, y: 10 } });
    await expect(title, style).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
});
