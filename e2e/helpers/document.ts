import { expect, type Page } from "@playwright/test";

export async function createBlankDocument(page: Page, title = "折叠回归") {
  await page.goto("/");
  await createDocumentInWorkspace(page, title);
}

/** Create without navigation so installed failure hooks and current sessions survive. */
export async function createDocumentInWorkspace(
  page: Page,
  title = "折叠回归",
) {
  // Read-only virtual documents contain many ProseMirror blocks.
  await expect(page.locator(".note-editor")).toBeVisible();
  const previousNoteId = await page.evaluate(() =>
    localStorage.getItem("nr:lastNote"),
  );
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill(title);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".note-title")).toHaveValue(title);
  await expect(page.locator(".ProseMirror")).toBeEditable();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote")))
    .not.toBe(previousNoteId);
  await expect(page.locator(".ProseMirror")).toHaveText("");
}

/** Check persisted content, not a saved badge left over from the previous edit. */
export async function waitForSavedText(page: Page, text: string) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/lib/api.ts";
        const { api } = await import(/* @vite-ignore */ path);
        const id = localStorage.getItem("nr:lastNote");
        if (!id) return null;
        const note = await api.notes.get(id);
        return note?.content?.ops
          ?.map((op: { insert?: unknown }) =>
            typeof op.insert === "string" ? op.insert : "",
          )
          .join("");
      }),
    )
    .toContain(text);
}
