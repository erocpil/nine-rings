import { expect, test } from "@playwright/test";

for (const readonly of [false, true]) {
  test(`切回${readonly ? "只读" : "可编辑"}文档保留折叠和刚刚滚动的位置`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    const ids = await page.evaluate(async (locked) => {
      const { api } = await import("/src/lib/api.ts");
      const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
      const a = await api.notes.create({
        title: "折叠位置 A",
        date: "2026-09-17",
        readonly: locked,
        content: {
          ops: [
            { insert: "首节" },
            { insert: "\n", attributes: { header: 1 } },
            { insert: "首节隐藏正文\n" },
            { insert: "第二节" },
            { insert: "\n", attributes: { header: 1 } },
            { insert: "const example = 1;" },
            { insert: "\n", attributes: { "code-block": true } },
            ...Array.from({ length: 90 }, (_, i) => ({
              insert: `阅读段落 ${i} ${"正文".repeat(30)}\n`,
            })),
          ],
        },
      });
      const b = await api.notes.create({
        title: "折叠位置 B",
        date: "2026-09-17",
        content: { ops: [{ insert: "其它文档\n" }] },
      });
      const selected = locked
        ? await api.notes.update(a.id, { readonly: true })
        : a;
      useNotesStore.getState().selectNote(selected);
      return { a: a.id, b: b.id };
    }, readonly);
    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText("首节隐藏正文");
    await expect(editor).toHaveAttribute("contenteditable", String(!readonly));
    await page
      .getByRole("button", { name: "折叠第 1 块章节", exact: true })
      .dispatchEvent("click");
    await page.getByRole("button", { name: "折叠代码块", exact: true }).click();
    await expect(
      editor.getByText("首节隐藏正文", { exact: true }),
    ).toBeHidden();
    await expect(page.locator(".code-block-wrap")).toHaveClass(/collapsed/);
    // Wait for initial opening restoration, then switch before the 220ms save debounce.
    await page.waitForTimeout(700);
    const before = await page.evaluate(async ({ b }) => {
      const { api } = await import("/src/lib/api.ts");
      const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
      const other = await api.notes.get(b);
      const root = document.querySelector<HTMLElement>(".note-editor-scroll")!;
      root.scrollTop = 950;
      root.dispatchEvent(new Event("scroll"));
      const top = root.scrollTop;
      useNotesStore.getState().selectNote(other);
      return top;
    }, ids);
    await expect(editor).toHaveText("其它文档");
    await page.evaluate(async ({ a }) => {
      const { api } = await import("/src/lib/api.ts");
      const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
      useNotesStore.getState().selectNote(await api.notes.get(a));
    }, ids);
    await expect(editor).toContainText("首节隐藏正文");
    await expect(
      editor.getByText("首节隐藏正文", { exact: true }),
    ).toBeHidden();
    await expect(page.locator(".code-block-wrap")).toHaveClass(/collapsed/);
    await expect
      .poll(() =>
        page.locator(".note-editor-scroll").evaluate((el) => el.scrollTop),
      )
      .toBeCloseTo(before, 0);
  });
}
