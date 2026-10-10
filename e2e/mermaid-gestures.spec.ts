import { expect, test, type Locator } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";

test.use({ hasTouch: true });
async function touches(
  target: Locator,
  type: string,
  points: { id: number; x: number; y: number }[],
) {
  return target.evaluate(
    (element, { type, points }) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const list = points.map((point) => ({
        identifier: point.id,
        clientX: point.x,
        clientY: point.y,
        target: element,
      }));
      Object.defineProperties(event, {
        touches: { value: list },
        targetTouches: { value: list },
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { type, points },
  );
}
async function finger(
  target: Locator,
  type: string,
  id: number,
  x: number,
  y: number,
) {
  await target.dispatchEvent(type, {
    pointerId: id,
    pointerType: "touch",
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
}

for (const readonly of [false, true])
  test(`正文 Mermaid 双指缩放及二维平移，单指仍可滚动，只读=${readonly}`, async ({
    page,
  }) => {
    await createBlankDocument(page);
    await closeDocumentSidebar(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(async () => {
      const path = "/src/lib/block-display-settings.ts";
      const { saveBlockWorkspacePreferences } = await import(
        /* @vite-ignore */ path
      );
      saveBlockWorkspacePreferences({ mermaidDisplay: "scroll" });
    });
    await page.locator(".ProseMirror").evaluate((element) => {
      const editor = (element as HTMLElement & { editor: Editor }).editor;
      const source =
        "flowchart TD\n" +
        Array.from(
          { length: 12 },
          (_, index) => `N${index}[A reasonably wide diagram node ${index}]`,
        ).join(" --> ");
      editor.commands.setContent(
        {
          type: "doc",
          content: [
            {
              type: "codeBlock",
              attrs: { language: "mermaid" },
              content: [{ type: "text", text: source }],
            },
          ],
        },
        true,
      );
    });
    if (readonly) {
      await page
        .getByRole("button", { name: "点击设为只读", exact: true })
        .click();
      await expect(page.locator(".ProseMirror")).toHaveAttribute(
        "contenteditable",
        "false",
      );
    }
    const diagram = page.locator(".note-editor .mermaid-diagram");
    await expect(diagram.locator("svg")).toBeVisible();
    const id = await diagram.locator("svg").getAttribute("id");
    const box = (await diagram.boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + 100;
    const sourceBefore = await page
      .locator(".ProseMirror")
      .evaluate((element) =>
        (element as HTMLElement & { editor: Editor }).editor.getJSON(),
      );
    expect(
      await touches(diagram, "touchstart", [{ id: 1, x: x - 30, y }]),
    ).toBe(false);
    await touches(diagram, "touchend", []);
    await touches(diagram, "touchstart", [
      { id: 1, x: x - 30, y },
      { id: 2, x: x + 30, y },
    ]);
    await touches(diagram, "touchmove", [
      { id: 2, x: x + 60, y },
      { id: 1, x: x - 60, y },
    ]);
    await expect(
      page.locator(".note-editor [data-mermaid-controls]").getByRole("status"),
    ).toHaveText("200%");
    const before = await diagram.evaluate((element) => ({
      x: element.scrollLeft,
      y: element.scrollTop,
    }));
    await touches(diagram, "touchmove", [
      { id: 1, x: x - 80, y: y - 25 },
      { id: 2, x: x + 40, y: y - 25 },
    ]);
    await expect
      .poll(() => diagram.evaluate((element) => element.scrollLeft))
      .toBeCloseTo(before.x + 20, 0);
    await expect
      .poll(() => diagram.evaluate((element) => element.scrollTop))
      .toBeCloseTo(before.y + 25, 0);
    const after = await diagram.evaluate((element) => ({
      x: element.scrollLeft,
      y: element.scrollTop,
    }));
    await touches(diagram, "touchcancel", []);
    await touches(diagram, "touchmove", [{ id: 1, x: x + 100, y: y + 100 }]);
    expect(
      await diagram.evaluate((element) => ({
        x: element.scrollLeft,
        y: element.scrollTop,
      })),
    ).toEqual(after);
    expect(await diagram.locator("svg").getAttribute("id")).toBe(id);
    expect(
      await page
        .locator(".ProseMirror")
        .evaluate((element) =>
          (element as HTMLElement & { editor: Editor }).editor.getJSON(),
        ),
    ).toEqual(sourceBefore);
  });

test("图像工作区双指同时缩放和平移，抬指与取消不跳动，适应恢复中心", async ({
  page,
}) => {
  await createBlankDocument(page);
  await page.locator(".ProseMirror").evaluate((element) => {
    (element as HTMLElement & { editor: Editor }).editor.commands.setContent(
      {
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { language: "mermaid" },
            content: [
              {
                type: "text",
                text:
                  "flowchart TD\n" +
                  Array.from(
                    { length: 8 },
                    (_, i) =>
                      `N${i}[Mermaid pinch gesture node with a long description and additional text ${i}]`,
                  ).join(" --> "),
              },
            ],
          },
        ],
      },
      true,
    );
  });
  await expect(page.locator(".mermaid-diagram svg")).toBeVisible();
  await page
    .locator(".code-block-wrap")
    .getByRole("button", { name: "放大阅读代码块" })
    .click();
  const dialog = page.getByRole("dialog", { name: "图像工作区" });
  const viewport = dialog.locator(".mermaid-diagram-viewport");
  await expect(viewport.locator("svg")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => viewport.evaluate((element) => element.clientWidth))
    .toBeLessThan(390);
  const box = (await viewport.boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await finger(viewport, "pointerdown", 1, x - 30, y);
  await finger(viewport, "pointerdown", 2, x + 30, y);
  await finger(viewport, "pointermove", 1, x - 90, y);
  await finger(viewport, "pointermove", 2, x + 90, y);
  await expect(
    dialog.locator(".mermaid-diagram-controls").getByRole("status"),
  ).toHaveText("300%");
  await finger(viewport, "pointermove", 1, x - 100, y + 15);
  await finger(viewport, "pointermove", 2, x + 140, y + 15);
  const canvas = viewport.locator(".mermaid-diagram-canvas");
  await expect(canvas).toHaveAttribute(
    "style",
    /translate\(20px, 15px\) scale\(4\)/,
  );
  await finger(viewport, "pointerup", 2, x + 140, y + 15);
  await finger(viewport, "pointermove", 1, x - 95, y + 20);
  await expect(canvas).toHaveAttribute(
    "style",
    /translate\(25px, 20px\) scale\(4\)/,
  );
  await finger(viewport, "pointercancel", 1, x - 95, y + 20);
  await finger(viewport, "pointermove", 1, x + 100, y + 100);
  await expect(canvas).toHaveAttribute(
    "style",
    /translate\(25px, 20px\) scale\(4\)/,
  );
  await dialog.getByRole("button", { name: "适应窗口" }).click();
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const transform = new DOMMatrix(getComputedStyle(element).transform);
        return [transform.a, transform.d, transform.e, transform.f];
      }),
    )
    .toEqual([1, 1, 0, 0]);
});
