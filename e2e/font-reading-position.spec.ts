import { expect, test, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";

async function prepare(page: Page) {
  await page.goto("/");
  const body = page.locator(".note-editor .ProseMirror");
  await expect(body).toBeVisible({ timeout: 15000 });
  await body.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({
      type: "doc",
      content: Array.from({ length: 100 }, (_, index) => ({
        type: "paragraph",
        content: [
          {
            type: "text",
            text:
              `段落 ${index}。` +
              "长段落字体重排需要保持可视区顶部的同一行文字。Reading position stays stable. ".repeat(
                15,
              ),
          },
        ],
      })),
    });
  });
  // Put the viewport inside a long paragraph, not at its beginning.
  await body.evaluate((element) => {
    const root = element.closest<HTMLElement>(".note-editor-scroll")!;
    root.scrollTop = root.scrollHeight * 0.45 + 13;
    (element as HTMLElement).blur();
  });
  await page.waitForTimeout(250);
  return body;
}

async function measureTop(page: Page) {
  return page.locator(".note-editor .ProseMirror").evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    const root = element.closest<HTMLElement>(".note-editor-scroll")!;
    const rect = root.getBoundingClientRect();
    const sticky = root.querySelector<HTMLElement>(
      ":scope > .note-editor-sticky",
    );
    const top =
      sticky && getComputedStyle(sticky).position === "sticky"
        ? Math.max(rect.top, sticky.getBoundingClientRect().bottom)
        : rect.top;
    const paragraph = [...element.querySelectorAll("p")].find(
      (node) => node.getBoundingClientRect().bottom > top,
    )!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const line = [...range.getClientRects()].find((box) => box.bottom > top)!;
    const pos = editor.view.posAtCoords({
      left: line.left + 1,
      top: Math.max(line.top + 1, top + 1),
    })!.pos;
    return { pos, offset: editor.view.coordsAtPos(pos).top - top };
  });
}

async function expectPreserved(
  page: Page,
  anchor: { pos: number; offset: number },
) {
  await expect
    .poll(() =>
      page.locator(".note-editor .ProseMirror").evaluate((element, saved) => {
        const editor = (element as HTMLElement & { editor: Editor }).editor;
        const root = element.closest<HTMLElement>(".note-editor-scroll")!;
        const rect = root.getBoundingClientRect();
        const sticky = root.querySelector<HTMLElement>(
          ":scope > .note-editor-sticky",
        );
        const top =
          sticky && getComputedStyle(sticky).position === "sticky"
            ? Math.max(rect.top, sticky.getBoundingClientRect().bottom)
            : rect.top;
        return Math.abs(
          editor.view.coordsAtPos(saved.pos).top - top - saved.offset,
        );
      }, anchor),
    )
    .toBeLessThanOrEqual(2);
}

for (const mobile of [false, true]) {
  test.describe(mobile ? "touch" : "mouse", () => {
    test.use({ hasTouch: mobile });
    test(`排版设置改变字体字号后顶部文字保持位置（${mobile ? "手机" : "桌面"}）`, async ({
      page,
    }) => {
      await page.setViewportSize(
        mobile ? { width: 390, height: 844 } : { width: 1600, height: 900 },
      );
      await prepare(page);
      const anchor = await measureTop(page);
      if (mobile) {
        await page.locator(".note-editor").evaluate((element) => {
          for (const [type, x] of [
            ["touchstart", 370],
            ["touchmove", 260],
            ["touchend", 260],
          ] as const) {
            const touch = {
              identifier: 41,
              target: element,
              clientX: x,
              clientY: 570,
            };
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperties(event, {
              touches: { value: type === "touchend" ? [] : [touch] },
              changedTouches: { value: [touch] },
            });
            element.dispatchEvent(event);
          }
        });
        await expect(
          page.getByRole("dialog", { name: "设置", exact: true }),
        ).toBeVisible();
      } else await page.getByTitle("设置").click();
      await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
      await page.getByRole("button", { name: /打开排版设置/ }).click();
      await page.getByLabel("正文字体").selectOption("monospace");
      for (let index = 0; index < 5; index++)
        await page.getByRole("button", { name: "增大正文与标题字号" }).click();
      await page.getByRole("button", { name: "应用到编辑器" }).click();
      await expect(page.getByRole("dialog", { name: "排版设置" })).toHaveCount(
        0,
      );
      await page.locator(".settings-close").click();
      await expectPreserved(page, anchor);
    });
  });
}

test("工具栏连续改变编辑器字号，顶部文字位置不累计漂移", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await prepare(page);
  const anchor = await measureTop(page);
  for (let index = 0; index < 4; index++) {
    await page.getByTitle("放大字号", { exact: true }).click();
    await expectPreserved(page, anchor);
  }
  for (let index = 0; index < 4; index++) {
    await page.getByTitle("缩小字号", { exact: true }).click();
    await expectPreserved(page, anchor);
  }
});
