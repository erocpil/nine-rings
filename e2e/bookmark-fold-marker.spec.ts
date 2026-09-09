import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  for (const numbers of [false, true]) {
    test(`书签标记不遮挡折叠三角 ${width} 块号=${numbers}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript((numbers) => {
        localStorage.setItem(
          "nine_rings_config",
          JSON.stringify({ editor_show_line_numbers: numbers }),
        );
      }, numbers);
      await page.goto("/");
      await expect(page.locator(".ProseMirror")).toBeVisible({
        timeout: 25000,
      });
      await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { api } = (await load(
          "/src/lib/api.ts",
        )) as typeof import("../src/lib/api");
        const { useNotesStore } = (await load(
          "/src/stores/useNotesStore.ts",
        )) as typeof import("../src/stores/useNotesStore");
        const note = await api.notes.create({
          title: "书签下划线验证",
          date: "2026-09-09",
          storagePath: "tests/markers",
          content: {
            ops: [
              { insert: "带书签标题" },
              { insert: "\n", attributes: { header: 1 } },
              { insert: "正文\n" },
            ],
            metadata: {
              bookmarks: [
                {
                  id: "marker",
                  position: 1,
                  preview: "带书签标题",
                  createdAt: new Date().toISOString(),
                },
              ],
            },
          },
        });
        useNotesStore
          .getState()
          .selectNote(await api.notes.update(note.id, { readonly: true }));
      });
      await expect(page.locator(".note-title")).toHaveValue("书签下划线验证");
      for (const focus of [false, true]) {
        if (focus)
          await page
            .getByRole("button", { name: "专注模式", exact: true })
            .click();
        const fold = page.locator(".editor-heading-fold").first();
        const marker = page.locator(".editor-block-bookmark.without-number");
        await expect(fold).toBeVisible();
        if (numbers) {
          await expect(marker).toHaveCount(0);
          await expect(
            page.locator(".editor-block-number.bookmarked"),
          ).toHaveCount(1);
        } else {
          await expect(marker).toHaveCount(1);
          const triangle = (await fold.boundingBox())!;
          const underline = (await marker.boundingBox())!;
          expect(underline.width).toBeGreaterThan(underline.height * 3);
          expect(
            Math.abs(
              underline.x +
                underline.width / 2 -
                triangle.x -
                triangle.width / 2,
            ),
          ).toBeLessThan(1);
          expect(underline.y).toBeGreaterThanOrEqual(
            triangle.y + triangle.height / 2 + 7,
          );
          await expect(marker).toHaveCSS("pointer-events", "none");
        }
        await fold.click();
        await expect(fold).toHaveText("▶");
        if (!numbers) await expect(marker).toBeVisible();
        await fold.click();
        await expect(fold).toHaveText("▼");
      }
    });
  }
}
