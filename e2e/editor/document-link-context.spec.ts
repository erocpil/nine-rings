import { expect, test } from "@playwright/test";
import { createBlankDocument } from "../helpers/document";
import { openWritableLocalDirectory } from "../helpers/local-files";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async (value: string) =>
        sessionStorage.setItem("copied-document-link", value),
    });
  });
});

test("Nine Rings 本地 Markdown 的链接右键只复制相对地址", async ({ page }) => {
  await createBlankDocument(page);
  const { workspace } = await openWritableLocalDirectory(
    page,
    { "guide.md": "[链接](./other.md#part)\n\n无链接\n" },
    "guide.md",
  );
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  const link = workspace.getByRole("link", { name: "链接", exact: true });
  await link.hover();
  await expect(
    page.getByRole("dialog", { name: "链接操作预览" }),
  ).toBeVisible();
  await link.click({ button: "right" });
  await expect(page.getByRole("dialog", { name: "链接操作预览" })).toHaveCount(
    0,
  );
  await page.getByRole("menuitem", { name: "复制链接", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("copied-document-link")),
    )
    .toBe("./other.md#part");
  await workspace
    .getByText("无链接", { exact: true })
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "复制链接", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  const body = workspace.locator(".ProseMirror");
  const top = () =>
    body.evaluate(
      (element) =>
        element.getBoundingClientRect().top -
        element
          .closest(".note-editor")!
          .querySelector(".document-title-bar")!
          .getBoundingClientRect().bottom,
    );
  const editable = await top();
  await workspace.getByRole("button", { name: "点击设为只读" }).click();
  await expect
    .poll(() =>
      body.evaluate((element) => (element as HTMLElement).isContentEditable),
    )
    .toBe(false);
  await expect.poll(top).toBe(editable);
});

for (const virtual of [false, true])
  test(`数据库 Markdown 右键复制链接，局部只读=${virtual}`, async ({
    page,
  }) => {
    await createBlankDocument(page);
    const href = "https://example.com/guide#part";
    await page.evaluate(
      async ({ href, virtual }) => {
        const { api } = await import("/src/lib/api.ts");
        const { mdToDelta } = await import("/src/lib/md-parser.ts");
        const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
        const { setReadonlyRenderingEnabled } =
          await import("/src/lib/readonly-rendering.ts");
        const note = await api.notes.create({
          title: "链接操作",
          date: useNotesStore.getState().currentDate,
          content: mdToDelta(`[目标链接](${href})\n`),
        });
        useNotesStore
          .getState()
          .selectNote(
            virtual
              ? await api.notes.update(note.id, { readonly: true })
              : note,
          );
        setReadonlyRenderingEnabled(virtual);
      },
      { href, virtual },
    );
    if (virtual)
      await expect(page.locator("[data-virtual-reader]")).toBeVisible();
    await page
      .getByRole("link", { name: "目标链接", exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "复制链接", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem("copied-document-link")),
      )
      .toBe(href);
    await expect(
      page.getByRole("menuitem", { name: "复制链接", exact: true }),
    ).toHaveCount(0);
  });
