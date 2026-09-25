import { expect, type Page } from "@playwright/test";
import { createBlankDocument } from "./document";

/** Wait for the newly created session, not the still-mounted previous editor. */
export async function createBlankNote(page: Page) {
  await createBlankDocument(page);
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeEditable();
  await expect(editor).toHaveText("");
  await editor.click();
  return editor;
}
