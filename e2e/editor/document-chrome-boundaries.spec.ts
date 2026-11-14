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
  await expect.poll(async () => {
    const title = (await editor.locator(".document-title-bar").boundingBox())!;
    const tools = (await toolbar.boundingBox())!;
    const inset = await editor.evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue("--document-edge-inset")));
    return Math.max(Math.abs(tools.x - title.x - inset), Math.abs(tools.x + tools.width - title.x - title.width + inset));
  }).toBeLessThan(2);
  const insert = editor.locator(".editor-block-insert").first();
  await expect(insert).toBeAttached();
  await expect.poll(async () => {
    const button = (await insert.boundingBox())!, tools = (await toolbar.boundingBox())!;
    return button.y - tools.y - tools.height;
  }).toBeGreaterThanOrEqual(0);
});
