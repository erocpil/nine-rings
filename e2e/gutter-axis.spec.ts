import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  for (const numbers of [false, true]) {
    test(`折叠标识与加号同轴 ${width}px 块号=${numbers}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript(numbers => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: numbers })), numbers);
      await page.goto("/");
      await expect(page.locator(".ProseMirror")).toBeVisible();
      await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
        const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
        const note = await api.notes.create({ title: "同轴验证", date: "2026-09-17", content: { ops: [
          { insert: "标题" }, { insert: "\n", attributes: { header: 1 } }, { insert: "正文\n" },
        ] } });
        useNotesStore.getState().selectNote(note);
      });
      const checkAxis = async () => {
        await expect(page.getByRole("button", { name: "折叠第 1 块章节", exact: true })).toBeVisible();
        await expect.poll(() => page.evaluate(() => {
          const fold = document.querySelector(".editor-heading-fold")!.getBoundingClientRect();
          return Math.max(...Array.from(document.querySelectorAll(".editor-block-insert"), button => {
            const rect = button.getBoundingClientRect();
            return Math.abs(rect.x + rect.width / 2 - fold.x - fold.width / 2);
          }));
        })).toBeLessThan(0.6);
      };
      await checkAxis();
      await page.getByRole("button", { name: "专注模式", exact: true }).click();
      await checkAxis();
      await page.getByRole("button", { name: "折叠第 1 块章节", exact: true }).click();
      await expect(page.getByRole("button", { name: "展开第 1 块章节", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "展开第 1 块章节", exact: true }).click();
      const insert = page.getByRole("button", { name: "在第一块前插入段落", exact: true });
      await insert.hover();
      await insert.click();
      await expect(page.locator(".ProseMirror > *")).toHaveCount(3);
    });
  }
}
