import { expect, test } from "@playwright/test";

for (const initialReadonly of [false, true]) {
  test(`初始只读状态不重复设置且切换后正确限制粘贴 ${initialReadonly}`, async ({
    page,
  }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible({ timeout: 25000 });
    const id = await editor.evaluate(async (element, readonly) => {
      const initial = (
        element as HTMLElement & { editor: import("@tiptap/core").Editor }
      ).editor;
      const prototype = Object.getPrototypeOf(
        initial,
      ) as import("@tiptap/core").Editor;
      const original = prototype.setEditable;
      const calls: boolean[] = [];
      Object.assign(window, { editabilityCalls: calls });
      prototype.setEditable = function (editable, emitUpdate) {
        if (this.getText() === "编辑权限回归正文") calls.push(editable);
        return original.call(this, editable, emitUpdate);
      };
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = (await load(
        "/src/lib/api.ts",
      )) as typeof import("../src/lib/api");
      const { useNotesStore } = (await load(
        "/src/stores/useNotesStore.ts",
      )) as typeof import("../src/stores/useNotesStore");
      const note = await api.notes.create({
        title: "编辑权限回归",
        date: "2026-09-09",
        storagePath: "tests/editability",
        content: { ops: [{ insert: "编辑权限回归正文\n" }] },
      });
      useNotesStore
        .getState()
        .selectNote(await api.notes.update(note.id, { readonly }));
      return note.id;
    }, initialReadonly);
    await expect(page.locator(".note-title")).toHaveValue("编辑权限回归");
    await expect(editor).toHaveAttribute(
      "contenteditable",
      String(!initialReadonly),
    );
    await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { editabilityCalls: boolean[] })
            .editabilityCalls,
      ),
    ).toEqual([]);

    for (const readonly of [!initialReadonly, initialReadonly]) {
      await page.evaluate(
        async ({ id, readonly }) => {
          const load = (path: string) => import(/* @vite-ignore */ path);
          const { api } = (await load(
            "/src/lib/api.ts",
          )) as typeof import("../src/lib/api");
          const { useNotesStore } = (await load(
            "/src/stores/useNotesStore.ts",
          )) as typeof import("../src/stores/useNotesStore");
          useNotesStore
            .getState()
            .selectNote(await api.notes.update(id, { readonly }));
        },
        { id, readonly },
      );
      await expect(editor).toHaveAttribute(
        "contenteditable",
        String(!readonly),
      );
      if (readonly) {
        const prevented = await editor.evaluate((element) => {
          const clipboardData = new DataTransfer();
          clipboardData.setData("text/plain", "不应插入");
          return !element.dispatchEvent(
            new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData,
            }),
          );
        });
        expect(prevented).toBe(true);
        await expect(editor).toHaveText("编辑权限回归正文");
      } else {
        await editor.click();
        await page.keyboard.press("End");
        await page.keyboard.type("!");
        await expect(editor).toHaveText("编辑权限回归正文!");
        await page.keyboard.press("Control+z");
        await expect(editor).toHaveText("编辑权限回归正文");
      }
    }
    // The React editor lifecycle may already apply the new option before the
    // synchronization effect. Verify actual permissions, not a setter count.
  });
}
