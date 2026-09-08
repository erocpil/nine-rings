import { expect, type Page } from "@playwright/test";

/** Wait for the newly created session, not the still-mounted previous editor. */
export async function createBlankNote(page: Page) {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  await expect(page.locator(".note-title")).toHaveValue("新随笔");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeEditable();
  await expect(editor).toHaveText("");
  await editor.click();
  return editor;
}
