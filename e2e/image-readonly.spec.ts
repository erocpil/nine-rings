import { expect, test, type Locator, type Page } from "@playwright/test";
import { createBlankNote } from "./helpers/editor-fixtures";

test.use({ hasTouch: true });

async function insertImage(page: Page) {
  const editor = await createBlankNote(page);
  await editor.evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/html", '<img width="180px" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'240\' height=\'120\'%3E%3Crect width=\'240\' height=\'120\' fill=\'blue\'/%3E%3C/svg%3E">');
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  const image = editor.locator(".resizable-image-wrapper img");
  await expect(image).toBeVisible();
  await expect(image).toHaveCSS("width", "180px");
  await expect(page.locator(".save-status-saved")).toBeVisible();
  return { editor, image, handle: editor.locator(".resize-handle") };
}

async function pointer(target: Locator, type: string, x: number) {
  await target.dispatchEvent(type, {
    bubbles: true, cancelable: true, pointerId: 71, pointerType: "touch",
    isPrimary: true, button: 0, clientX: x, clientY: 200,
  });
}

const selectionStyles = (page: Page) => page.evaluate(() =>
  ["user-select", "-webkit-user-select"].map((property) => document.body.style.getPropertyValue(property)));

for (const width of [390, 1280]) {
  test(`只读图片隐藏缩放手柄且普通和专注模式均不修改尺寸（${width}px）`, async ({ page }) => {
    const { editor, image, handle } = await insertImage(page);
    await page.getByRole("button", { name: "隐藏侧栏", exact: true }).first().click();
    await page.setViewportSize({ width, height: 800 });
    await image.click();
    await expect(handle).toBeVisible();
    await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    await expect(editor).toHaveAttribute("contenteditable", "false");
    await page.evaluate(async () => {
      const path = "/src/lib/api.ts";
      const { api }: typeof import("../src/lib/api") = await import(/* @vite-ignore */ path);
      const original = api.notes.update;
      Object.assign(window, { readonlyImageWrites: 0 });
      api.notes.update = (id, data) => {
        if (data.content !== undefined) (window as unknown as { readonlyImageWrites: number }).readonlyImageWrites++;
        return original(id, data);
      };
    });

    for (const focused of [false, true]) {
      if (focused) await page.getByTitle("专注模式", { exact: true }).click();
      await image.hover();
      await expect(image).toBeVisible();
      await expect(handle).toBeHidden();
      // Even late/synthetic events must not mutate the readonly document.
      await image.dispatchEvent("dblclick", { bubbles: true, cancelable: true });
      await pointer(image, "pointerup", 180);
      await pointer(image, "pointerup", 180);
      await pointer(handle, "pointerdown", 180);
      await pointer(handle, "pointermove", 250);
      await pointer(handle, "pointerup", 250);
      await expect(image).toHaveCSS("width", "180px");
      expect(await selectionStyles(page)).toEqual(["", ""]);
    }
    // Exceed autosave's debounce: readonly gestures cannot schedule a save.
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => (window as unknown as { readonlyImageWrites: number }).readonlyImageWrites)).toBe(0);

    await page.locator('[title="退出专注模式"]:visible').click();
    await page.getByRole("button", { name: "点击设为可编辑", exact: true }).click();
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await image.hover();
    await expect(handle).toBeVisible();
    await pointer(handle, "pointerdown", 180);
    await pointer(handle, "pointermove", 220);
    await expect(image).toHaveCSS("width", "220px");
    await pointer(handle, "pointerup", 220);
    await expect(page.locator(".save-status-saved")).toBeVisible();
    await image.dispatchEvent("dblclick", { bubbles: true, cancelable: true });
    await expect.poll(() => image.evaluate((element) => element.style.width)).toBe("");
    await expect(page.locator(".save-status-saved")).toBeVisible();

    await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    // The button awaits an IndexedDB write; click completion alone does not
    // mean the readonly flag has persisted before navigation tears down the page.
    await expect(editor).toHaveAttribute("contenteditable", "false");
    await page.reload();
    await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
    await expect(page.locator(".resizable-image-wrapper img")).toBeVisible();
    await expect(page.locator(".resize-handle")).toBeHidden();
  });
}

test("图片缩放途中切换只读取消预览并清理拖拽状态", async ({ page }) => {
  const { editor, image, handle } = await insertImage(page);
  await pointer(handle, "pointerdown", 180);
  await pointer(handle, "pointermove", 260);
  await expect(image).toHaveCSS("width", "260px");
  expect(await selectionStyles(page)).toContain("none");

  // Change mode while a pointer is held, without generating its pointerup.
  await page.getByRole("button", { name: "点击设为只读", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(handle).toBeHidden();
  await expect(image).toHaveCSS("width", "180px");
  expect(await selectionStyles(page)).toEqual(["", ""]);
  await pointer(page.locator("body"), "pointermove", 300);
  await pointer(page.locator("body"), "pointerup", 300);
  await expect(image).toHaveCSS("width", "180px");

  await page.getByRole("button", { name: "点击设为可编辑", exact: true }).click();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await pointer(handle, "pointerdown", 180);
  await pointer(handle, "pointermove", 220);
  await expect(image).toHaveCSS("width", "220px");
  await pointer(handle, "pointercancel", 220);
  await expect(image).toHaveCSS("width", "180px");
  expect(await selectionStyles(page)).toEqual(["", ""]);
});
