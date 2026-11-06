import { expect, test } from "@playwright/test";

for (const virtual of [false, true]) {
  test(`只读专注三击折叠展开保持当前块，拖选仍可复制 ${virtual ? "virtual" : "full"}`, async ({ page }) => {
    await page.addInitScript(virtual => {
      localStorage.setItem("nr:focusMode", "true");
      localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true }));
      localStorage.setItem("nr:blockWorkspaceDisplay", JSON.stringify({ relativeBlockNumbers: true }));
      localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual));
    }, virtual);
    await page.goto("/");
    await expect(page.locator(".ProseMirror:visible")).toBeVisible();
    await page.evaluate(async () => {
      const { api } = await import("/src/lib/api.ts");
      const { mdToDelta } = await import("/src/lib/md-parser.ts");
      const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
      const note = await api.notes.create({ title: "折叠与选择", date: "2026-10-10", storagePath: "ideas", content: mdToDelta("# Selection heading\n\nDrag this paragraph to copy its text.\n\n# Next chapter\n\nOther content.") });
      useNotesStore.getState().selectNote(await api.notes.update(note.id, { readonly: true }));
    });
    const body = page.locator(virtual ? ".vr-body:visible" : ".note-editor-readonly .ProseMirror:visible");
    const heading = body.locator("h1").filter({ hasText: "Selection heading" });
    const paragraph = body.getByText("Drag this paragraph to copy its text.", { exact: true });
    const selection = () => page.evaluate(() => window.getSelection()?.toString() ?? "");
    await expect(paragraph).toBeVisible();
    const headingPoint = await heading.evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.textContent?.includes("Selection heading")) continue;
        const range = document.createRange();
        range.setStart(node, 2);
        range.setEnd(node, 3);
        const text = range.getBoundingClientRect(), box = element.getBoundingClientRect();
        return { x: text.left - box.left + text.width / 2, y: text.top - box.top + text.height / 2 };
      }
      throw new Error("Missing heading text");
    });
    for (let i = 0; i < 2; i++) {
      await heading.click({ position: headingPoint, clickCount: 3 });
      await expect(paragraph).toBeHidden();
      await expect(page.locator(".editor-block-number.relative-current:visible")).toHaveAttribute("data-block-index", "1");
      await expect.poll(selection).toBe("");
      await heading.click({ position: headingPoint, clickCount: 3 });
      await expect(paragraph).toBeVisible();
      await expect(page.locator(".editor-block-number.relative-current:visible")).toHaveAttribute("data-block-index", "1");
      await expect.poll(selection).toBe("");
    }
    const points = await paragraph.evaluate(element => {
      const node = element.firstChild!;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 1);
      const first = range.getBoundingClientRect();
      range.setStart(node, 34);
      range.setEnd(node, 35);
      const last = range.getBoundingClientRect();
      return { x: first.left + 1, y: first.top + first.height / 2, endX: last.right - 1, endY: last.top + last.height / 2 };
    });
    await page.mouse.move(points.x, points.y);
    await page.mouse.down();
    await page.mouse.move(points.endX, points.endY, { steps: 12 });
    await page.mouse.up();
    await expect.poll(selection).toContain("paragraph to copy");
    const selected = await selection();
    await page.keyboard.press("ControlOrMeta+c");
    await page.evaluate(() => {
      const textarea = document.createElement("textarea");
      textarea.id = "copy-verification";
      textarea.style.cssText = "position:fixed;bottom:0;right:0;z-index:9999";
      document.body.append(textarea);
      textarea.focus();
    });
    await page.keyboard.press("ControlOrMeta+v");
    await expect(page.locator("#copy-verification")).toHaveValue(selected);
    await page.locator("#copy-verification").evaluate(element => element.remove());
    await page.getByRole("button", { name: "退出专注模式", exact: true }).click();
    await heading.dblclick({ position: headingPoint });
    await expect(paragraph).toBeVisible();
    await expect.poll(selection).toContain("Selection");
  });
}
