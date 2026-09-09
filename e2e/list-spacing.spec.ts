import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";

for (const readonly of [false, true]) {
  test(`紧凑列表保留编号列、嵌套及自定义间距 ${readonly ? "只读" : "编辑"}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const editor = page.locator(".note-editor .ProseMirror");
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.evaluate((element, readonly) => {
      const instance = (element as HTMLElement & { editor: Editor }).editor;
      const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
      const item = (text: string) => ({ type: "listItem", content: [paragraph(text)] });
      instance.commands.setContent({ type: "doc", content: [
        paragraph("列表前的正文"),
        { type: "bulletList", content: [item("第一项很长的正文需要在窄屏幕换行，以确认续行保持与第一行相同的文字起点。"),
          { type: "listItem", content: [paragraph("第二项"), { type: "orderedList", attrs: { start: 26 }, content: [item("嵌套编号"), item("嵌套编号二")] }] }] },
        { type: "orderedList", content: [item("有序第一项"), item("有序第二项")] },
        { type: "orderedList", attrs: { start: 99 }, content: [item("九十九"), item("一百")] },
      ] });
      instance.setEditable(!readonly);
    }, readonly);
    const original = await editor.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.getJSON());
    for (const indent of [1, 1.25, 2.5]) {
      for (const gap of [0.1, 0.35, 0.8]) {
        const geometry = await editor.evaluate((element, { indent, gap }) => {
          const root = element as HTMLElement;
          root.style.setProperty("--editor-list-indent", `${indent}em`);
          root.style.setProperty("--editor-list-marker-gap", `${gap}em`);
          const paragraphLeft = root.querySelector("p")!.getBoundingClientRect().left;
          return Array.from(root.querySelectorAll("ul, ol")).map(list => {
            const item = list.querySelector(":scope > li")!;
            const style = getComputedStyle(list);
            const marker = getComputedStyle(item, "::before");
            const padding = parseFloat(style.paddingInlineStart);
            const font = parseFloat(style.fontSize);
            return {
              topLevel: list.parentElement === root,
              left: list.getBoundingClientRect().left - paragraphLeft,
              textInset: item.getBoundingClientRect().left - list.getBoundingClientRect().left,
              padding, font,
              markerLeft: item.getBoundingClientRect().right - parseFloat(marker.right) - parseFloat(marker.width) - list.getBoundingClientRect().left,
              bullet: list.tagName === "UL",
              counter: style.counterReset,
              decimal: style.getPropertyValue("--editor-ordered-decimal-column").trim(),
              native: getComputedStyle(item, "::marker").content,
            };
          });
        }, { indent, gap });
        for (const list of geometry) {
          if (list.topLevel) expect(list.left).toBeCloseTo(0, 1);
          expect(list.textInset).toBeCloseTo(list.padding, 1);
          expect(list.padding).toBeGreaterThanOrEqual(indent * list.font - 0.1);
          expect(list.markerLeft).toBeGreaterThanOrEqual(-1);
          if (list.bullet) expect(list.markerLeft).toBeCloseTo(list.padding - (gap + 0.5) * list.font, 1);
          expect(list.native).toBe('""');
        }
        expect(geometry.at(-1)!.decimal).toBe("4ch");
        expect(geometry.at(-1)!.counter).toContain("98");
        expect(geometry.at(-1)!.padding).toBeGreaterThanOrEqual(geometry.at(-2)!.padding);
      }
    }
    expect(await editor.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(original);
    await editor.evaluate(el => {
      (el as HTMLElement).style.removeProperty("--editor-list-indent");
      (el as HTMLElement).style.removeProperty("--editor-list-marker-gap");
    });
    await page.screenshot({ path: `/tmp/nr-list-spacing-${readonly ? "read" : "edit"}.png` });
    if (!readonly) {
      for (const tag of ["ul", "ol"]) {
        await editor.locator(`:scope > ${tag} > li > p`).nth(1).click();
        await page.keyboard.press("End");
        const before = await editor.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.getJSON());
        await page.keyboard.press("Tab");
        await expect(editor.locator(`:scope > ${tag} > li > ${tag}`)).toHaveCount(1);
        await page.keyboard.press("Shift+Tab");
        expect(await editor.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(before);
        const count = await editor.locator(`:scope > ${tag} > li`).count();
        await page.keyboard.press("Enter");
        await expect(editor.locator(`:scope > ${tag} > li`)).toHaveCount(count + 1);
        await page.keyboard.press("Backspace");
        await expect(editor.locator(`:scope > ${tag} > li`)).toHaveCount(count);
      }
    }
  });
}
