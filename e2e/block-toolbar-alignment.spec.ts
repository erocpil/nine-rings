import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

for (const [width, height, touch] of [
  [390, 800, true],
  [844, 390, true],
  [1280, 800, false],
] as const) {
  test.describe(`块工具位置 ${width}`, () => {
    test.use({ viewport: { width, height }, hasTouch: touch });
    test("引用与代码的最大化、折叠按钮对齐", async ({ page }) => {
      test.setTimeout(60000);
      // Create through the UI before changing to the tested viewport. Avoid an
      // async API/import evaluation spanning a document switch during startup.
      await page.setViewportSize({ width: 1280, height: 800 });
      await createBlankDocument(page, "块工具对齐");
      await page.locator(".ProseMirror").evaluate(element => {
        const editor = (element as HTMLElement & { editor: Editor }).editor;
        editor.commands.setContent({
          type: "doc",
          content: [
            { type: "codeBlock", content: [{ type: "text", text: "code" }] },
            { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "引用内容" }] }] },
          ],
        });
      });
      await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
      await page.setViewportSize({ width, height });
      if (width < 900) await page.locator(".sidebar-tab-hide").click();
      await expect.poll(() => page.locator(".note-title").evaluate(element =>
        element instanceof HTMLInputElement ? element.value : element.textContent,
      )).toBe("块工具对齐");
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
