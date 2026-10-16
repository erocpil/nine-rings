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

test("旧式段内换行不会拆开嵌套列表，保存重载后父子关系保持", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  const id = await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    const note = await api.notes.create({
      title: "Nested break regression",
      date: "2026-10-16",
      content: {
        ops: [
          { insert: "Parent" },
          { insert: "\n", attributes: { list: "bullet" } },
          { insert: "Child before" },
          { insert: "\nafter", attributes: { code: true } },
          { insert: "\n", attributes: { list: "bullet", indent: 1 } },
          { insert: "Sibling" },
          { insert: "\n", attributes: { list: "bullet" } },
          { insert: "Tail" },
          { insert: "\n" },
        ],
      },
    });
    useNotesStore.getState().selectNote(note);
    return note.id;
  });
  const root = page.locator(".note-editor .ProseMirror");
  await expect(root.locator("ul")).toHaveCount(2);
  await expect(root.locator("ul ul code br")).toHaveCount(1);
  await expect(root.locator(":scope > ul > li")).toHaveCount(2);
  await root.locator(":scope > p").last().click();
  await page.keyboard.type("!");
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const { api } = await import("/src/lib/api.ts");
        return JSON.stringify((await api.notes.get(id))?.content).includes(
          '"hard-break":true',
        );
      }, id),
    )
    .toBe(true);
  await page.reload();
  await expect(root.locator("ul")).toHaveCount(2);
  await expect(root.locator(":scope > ul > li")).toHaveCount(2);
  await expect(root.locator("ul ul code br")).toHaveCount(1);
});
