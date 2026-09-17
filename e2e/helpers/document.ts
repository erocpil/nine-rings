import { expect, type Page } from "@playwright/test";

export async function createBlankDocument(page: Page) {
  await page.goto("/");
  const previousNoteId = await page.evaluate(() =>
    localStorage.getItem("nr:lastNote"),
  );
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill("折叠回归");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".note-title")).toHaveValue("折叠回归");
  await expect(page.locator(".ProseMirror")).toBeEditable();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote")))
    .not.toBe(previousNoteId);
  await expect(page.locator(".ProseMirror")).toHaveText("");
}
