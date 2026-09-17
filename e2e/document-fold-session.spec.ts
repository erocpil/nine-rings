import { expect, test } from "@playwright/test";

// This suite tests in-app navigation; service-worker activation/reload is
// covered separately by the PWA tests and would discard the session itself.
test.use({ serviceWorkers: "block" });

for (const navigation of [
  "快速切换",
  "文档列表",
  "文档树",
  "手机文档树",
  "手机文档列表",
]) {
  for (const readonly of [false, true]) {
    test(`${navigation}：切回${readonly ? "只读" : "可编辑"}文档保留折叠和刚刚滚动的位置`, async ({
      page,
    }) => {
      if (navigation.startsWith("手机"))
        await page.setViewportSize({ width: 390, height: 760 });
      await page.goto("/");
      await expect(page.locator(".ProseMirror")).toBeVisible();
      const ids = await page.evaluate(async (locked) => {
        const { api } = await import("/src/lib/api.ts");
        const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
        const a = await api.notes.create({
          title: "折叠位置 A",
          date: "2026-09-17",
          storagePath: "references/fold-session",
          content: {
            ops: [
              { insert: "首节" },
              { insert: "\n", attributes: { header: 1 } },
              { insert: "首节隐藏正文" },
              { insert: "\n" },
              { insert: "第二节" },
              { insert: "\n", attributes: { header: 1 } },
              { insert: "const example = 1;" },
              { insert: "\n", attributes: { "code-block": true } },
              ...Array.from({ length: 90 }, (_, i) => [
                { insert: `阅读段落 ${i} ${"正文".repeat(30)}` },
                { insert: "\n" },
              ]).flat(),
            ],
          },
        });
        const b = await api.notes.create({
          title: "折叠位置 B",
          storagePath: "references/fold-session",
          date: "2026-09-17",
          content: { ops: [{ insert: "其它文档\n" }] },
        });
        const selected = locked
          ? await api.notes.update(a.id, { readonly: true })
          : a;
        useNotesStore.getState().selectNote(selected);
        return { a: a.id, b: b.id };
      }, readonly);
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote")))
        .toBe(ids.a);
      await page.reload();
      const selectFromUi = async (title: string) => {
        if (navigation.startsWith("手机")) {
          // The current phone UI opens tree/list from the upper/middle left edge.
          await page.locator(".note-editor").evaluate(
            (element, y) => {
              const dispatch = (type: string, x: number) => {
                const touch = {
                  identifier: 41,
                  target: element,
                  clientX: x,
                  clientY: y,
                };
                const event = new Event(type, {
                  bubbles: true,
                  cancelable: true,
                });
                Object.defineProperties(event, {
                  touches: { value: type === "touchend" ? [] : [touch] },
                  changedTouches: { value: [touch] },
                });
                element.dispatchEvent(event);
              };
              dispatch("touchstart", 8);
              dispatch("touchmove", 110);
              dispatch("touchend", 110);
            },
            navigation === "手机文档树" ? 150 : 380,
          );
        } else {
          const button = page
            .locator(".desktop-activity-bar")
            .getByRole("button", { name: navigation, exact: true });
          if ((await button.getAttribute("aria-pressed")) !== "true")
            await button.click();
        }
        const panel = navigation.endsWith("文档列表")
          ? page.locator(".document-browser")
          : page.locator(".app-sidebar .doc-tree");
        if (navigation.endsWith("文档列表"))
          await panel
            .getByRole("button", { name: "全部文档", exact: true })
            .click();
        await panel.getByText(title, { exact: true }).click();
      };
      const editor = page.locator(".ProseMirror");
      await expect(editor).toContainText("首节隐藏正文");
      await expect(
        editor.locator(":scope > p").filter({ hasText: "首节隐藏正文" }),
      ).toHaveCount(1);
      await expect(editor).toHaveAttribute(
        "contenteditable",
        String(!readonly),
      );
      await page
        .getByRole("button", { name: "折叠第 1 块章节", exact: true })
        .dispatchEvent("click");
      await expect(
        page.getByRole("button", { name: "展开第 1 块章节", exact: true }),
      ).toBeAttached();
      await page
        .getByRole("button", { name: "折叠代码块", exact: true })
        .click();
      await expect(
        editor.getByText("首节隐藏正文", { exact: true }),
      ).toBeHidden();
      await expect(page.locator(".code-block-wrap")).toHaveClass(/collapsed/);
      // Wait for initial opening restoration, then switch before the 220ms save debounce.
      await page.waitForTimeout(700);
      const before = await page.evaluate(
        async ({ b, direct }) => {
          const { api } = await import("/src/lib/api.ts");
          const { useNotesStore } =
            await import("/src/stores/useNotesStore.ts");
          const other = await api.notes.get(b);
          const root = document.querySelector<HTMLElement>(
            ".note-editor-scroll",
          )!;
          root.scrollTop = 950;
          root.dispatchEvent(new Event("scroll"));
          const top = root.scrollTop;
          if (direct) useNotesStore.getState().selectNote(other);
          return top;
        },
        { ...ids, direct: navigation === "快速切换" },
      );
      if (navigation !== "快速切换") await selectFromUi("折叠位置 B");
      await expect(editor).toHaveText("其它文档");
      if (navigation !== "快速切换") await selectFromUi("折叠位置 A");
      else {
        await page.evaluate(async ({ a }) => {
          const { api } = await import("/src/lib/api.ts");
          const { useNotesStore } =
            await import("/src/stores/useNotesStore.ts");
          useNotesStore.getState().selectNote(await api.notes.get(a));
        }, ids);
      }
      await expect(editor).toContainText("首节隐藏正文");
      await expect(
        page.getByRole("button", { name: "展开第 1 块章节", exact: true }),
      ).toBeAttached();
      await expect(
        editor.locator(":scope > p").filter({ hasText: "首节隐藏正文" }),
      ).toHaveCount(1);
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
}
