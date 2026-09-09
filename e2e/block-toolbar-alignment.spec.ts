import { expect, test } from "@playwright/test";

for (const [width, height, touch] of [
  [390, 800, true],
  [844, 390, true],
  [1280, 800, false],
] as const) {
  test.describe(`块工具位置 ${width}`, () => {
    test.use({ viewport: { width, height }, hasTouch: touch });
    test("引用与代码的最大化、折叠按钮对齐", async ({ page }) => {
      test.setTimeout(60000);
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
          title: "块工具对齐",
          date: "2026-09-10",
          storagePath: "tests/toolbar",
          content: {
            ops: [
              { insert: "code" },
              { insert: "\n", attributes: { "code-block": true } },
              { insert: "引用内容" },
              { insert: "\n", attributes: { blockquote: true } },
            ],
          },
        });
        useNotesStore
          .getState()
          .selectNote(await api.notes.update(note.id, { readonly: true }));
      });
      await expect(page.locator(".note-title")).toHaveValue("块工具对齐");
      for (const focus of [false, true]) {
        if (focus)
          await page
            .getByRole("button", { name: "专注模式", exact: true })
            .click();
        for (const collapsed of [false, true]) {
          if (collapsed) {
            await page
              .getByRole("button", { name: "折叠代码块", exact: true })
              .click();
            await page
              .getByRole("button", { name: "折叠引用块", exact: true })
              .click();
          }
          const geometry = await page
            .locator(".ProseMirror")
            .evaluate((root) => {
              return [".code-block-wrap", ".blockquote-wrap"].map(
                (selector) => {
                  const block = root.querySelector(selector)!;
                  const bounds = block.getBoundingClientRect();
                  return [
                    block.querySelector(".block-workspace-open")!,
                    block.querySelector(
                      'button[aria-label$="代码块"]:last-child, button[aria-label$="引用块"]:last-child',
                    )!,
                  ].map((button) => {
                    const rect = button.getBoundingClientRect();
                    return {
                      x: rect.x + rect.width / 2,
                      y: rect.y + rect.height / 2 - bounds.top,
                      width: rect.width,
                      height: rect.height,
                    };
                  });
                },
              );
            });
          for (const index of [0, 1]) {
            for (const key of ["x", "y", "width", "height"] as const) {
              expect(
                Math.abs(geometry[0][index][key] - geometry[1][index][key]),
                `${key} control ${index}`,
              ).toBeLessThanOrEqual(1);
            }
          }
        }
        await page
          .getByRole("button", { name: "展开代码块", exact: true })
          .click();
        await page
          .getByRole("button", { name: "展开引用块", exact: true })
          .click();
      }
      await page
        .getByRole("button", { name: "放大阅读引用块", exact: true })
        .click();
      await expect(page.locator(".block-workspace")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".block-workspace")).toHaveCount(0);
    });
  });
}
