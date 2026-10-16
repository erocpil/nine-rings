import { expect, test } from "@playwright/test";

test("旧行内代码和链接的换行格式在真实编辑、保存和重载后保留", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  const id = await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    const note = await api.notes.create({
      title: "Marked break regression",
      date: "2026-10-16",
      content: {
        ops: [
          { insert: "Before" },
          { insert: "\nCode", attributes: { code: true } },
          { insert: "\n" },
          { insert: "Before" },
          {
            insert: "\nLink",
            attributes: {
              link: "https://example.com/a",
              linkTitle: "Example",
              linkExplicit: true,
            },
          },
          { insert: "\n" },
          { insert: "Tail" },
          { insert: "\n" },
        ],
      },
    });
    useNotesStore.getState().selectNote(note);
    return note.id;
  });
  const root = page.locator(".note-editor .ProseMirror");
  await expect(root.locator("code br")).toHaveCount(1);
  await expect(root.locator('a[href="https://example.com/a"] br')).toHaveCount(
    1,
  );
  await root.locator("p").last().click();
  await page.keyboard.type("!");
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const { api } = await import("/src/lib/api.ts");
        const note = await api.notes.get(id);
        const body =
          typeof note?.content === "string"
            ? JSON.parse(note.content)
            : note?.content;
        return body?.ops
          .filter(
            (op: { attributes?: Record<string, unknown> }) =>
              op.attributes?.["hard-break"] === true,
          )
          .map((op: { attributes: Record<string, unknown> }) => op.attributes);
      }, id),
    )
    .toEqual([
      { code: true, "hard-break": true },
      {
        link: "https://example.com/a",
        linkTitle: "Example",
        linkExplicit: true,
        "hard-break": true,
      },
    ]);
  await page.reload();
  await expect(root.locator("code br")).toHaveCount(1);
  await expect(
    root.locator('a[href="https://example.com/a"][title="Example"] br'),
  ).toHaveCount(1);
});
