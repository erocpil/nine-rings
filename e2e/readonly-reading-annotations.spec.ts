import { expect, test, type Page } from "@playwright/test";
import { createBlankNote } from "./helpers/editor-fixtures";

const SAMPLE = "Reading annotation text stays outside the document body.";

for (const virtual of [false, true]) {
  test(`只读${virtual ? "虚拟" : "完整"}渲染：阅读标注暂停但保留已有数据`, async ({ page }) => {
    const editor = await createBlankNote(page);
    await editor.fill(SAMPLE);
    const noteId = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
    await expect.poll(async () => page.evaluate(async id => {
      const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
      return JSON.stringify((await api.notes.get(id))?.content.ops);
    }, noteId)).toContain(SAMPLE);

    const seed = {
      id: "paused-reading-annotation",
      noteId,
      from: 1,
      to: 8,
      exact: "Reading",
      prefix: "",
      suffix: " annotation",
      note: "保留但暂不展示",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
    };
    await page.evaluate(async annotation => {
      const { putReadingAnnotation } = await import(/* @vite-ignore */ "/src/lib/reading-annotations.ts");
      await putReadingAnnotation(annotation);
    }, seed);

    if (virtual) {
      await page.evaluate(() => {
        localStorage.setItem("nr:experimentalReadonlyRendering", "true");
        window.dispatchEvent(new Event("nine-rings:readonly-rendering-change"));
      });
    }
    await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    const body = page.locator(virtual ? ".vr-body" : ".editor-content").last();
    await expect(body).toContainText(SAMPLE);
    await expect(body.locator("[data-reading-annotation]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "文档书签", exact: true }).first()).toBeVisible();

    if (!virtual) {
      await body.evaluate(element => element.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: 100, clientY: 100,
      })));
      await expect(page.getByRole("button", { name: /阅读标注/ })).toHaveCount(0);
    }

    await expect.poll(async () => page.evaluate(async id => {
      const { listReadingAnnotations } = await import(/* @vite-ignore */ "/src/lib/reading-annotations.ts");
      return (await listReadingAnnotations(id)).map(annotation => annotation.id);
    }, noteId)).toContain(seed.id);
    await expect(page.locator(".reading-annotation-bubble, .reading-annotation-context")).toHaveCount(0);
  });
}
