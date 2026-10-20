import { expect, test, type Page } from "@playwright/test";
import { createBlankNote } from "./helpers/editor-fixtures";

const SAMPLE = "Reading annotation text should stay outside the document body.";
const SELECTED = "annotation text";

async function createReadonlySelection(page: Page, virtual: boolean) {
  const editor = await createBlankNote(page);
  await editor.fill(SAMPLE);
  await expect.poll(async () => page.evaluate(async () => {
    const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
    const note = await api.notes.get(localStorage.getItem("nr:lastNote"));
    return JSON.stringify(note?.content.ops);
  })).toContain(SAMPLE);
  const before = await page.evaluate(async () => {
    const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
    const id = localStorage.getItem("nr:lastNote");
    const note = await api.notes.get(id);
    return { id, content: JSON.stringify(note?.content.ops) };
  });
  if (virtual) {
    await page.evaluate(() => {
      localStorage.setItem("nr:experimentalReadonlyRendering", "true");
      window.dispatchEvent(new Event("nine-rings:readonly-rendering-change"));
    });
  }
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  const body = page.locator(virtual ? ".vr-body" : ".editor-content").last();
  await expect(body).toContainText(SAMPLE);
  await body.evaluate((element, selected) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const value = node.textContent ?? "";
      const index = value.indexOf(selected);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + selected.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error("test selection text was not rendered");
  }, SELECTED);
  const box = await body.boundingBox();
  await body.evaluate((element, point) => element.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true, cancelable: true, clientX: point.x, clientY: point.y,
  })), { x: Math.round((box?.x ?? 80) + 40), y: Math.round((box?.y ?? 100) + 30) });
  return { body, before };
}

for (const virtual of [false, true]) {
  test(`只读${virtual ? "虚拟" : "完整"}渲染：选区标注独立保存、汇总到书签并可管理`, async ({ page }) => {
    const { body, before } = await createReadonlySelection(page, virtual);
    const contextMenu = page.locator(virtual ? ".reading-annotation-context" : ".editor-context-menu");
    await expect(contextMenu).toBeVisible();
    const addAction = virtual
      ? contextMenu.getByRole("menuitem", { name: "添加阅读高亮", exact: true })
      : contextMenu.getByRole("button", { name: "选中文字并添加阅读标注", exact: true });
    await addAction.click();
    const marker = body.locator("[data-reading-annotation]").first();
    await expect(marker).toBeVisible();
    await marker.click();
    const bubble = page.locator(".reading-annotation-bubble");
    await expect(bubble).toBeVisible();
    await bubble.getByRole("button", { name: "修改", exact: true }).click();
    await bubble.getByRole("textbox", { name: "标注内容" }).fill("用于说明关键概念");
    await bubble.getByRole("button", { name: "保存", exact: true }).click();
    await expect(bubble.locator(".reading-annotation-note")).toHaveText("用于说明关键概念");

    const panelTrigger = page.getByRole("button", { name: /书签与标注/ }).first();
    await panelTrigger.click();
    await expect(page.locator(".reading-annotation-panel-row, .vr-reading-annotation").first()).toContainText("用于说明关键概念");

    await marker.hover();
    await expect(bubble).toBeVisible();
    await bubble.getByRole("button", { name: "清空", exact: true }).click();
    await expect(bubble.locator(".reading-annotation-note")).toHaveCount(0);
    await expect(body.locator("[data-reading-annotation]")).toHaveCount(1);
    await bubble.getByRole("button", { name: "删除", exact: true }).click();
    await expect(body.locator("[data-reading-annotation]")).toHaveCount(0);

    const after = await page.evaluate(async () => {
      const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
      const id = localStorage.getItem("nr:lastNote");
      const note = await api.notes.get(id);
      return JSON.stringify(note?.content.ops);
    });
    expect(after).toBe(before.content);
  });
}

for (const virtual of [false, true]) {
  test(`只读${virtual ? "虚拟" : "完整"}渲染：右键触发标注菜单时保留已捕获选区`, async ({ page }) => {
    const { body } = await createBlankNote(page).then(async editor => {
      await editor.fill(SAMPLE);
      await expect.poll(async () => page.evaluate(async () => {
        const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
        return JSON.stringify((await api.notes.get(localStorage.getItem("nr:lastNote")))?.content.ops);
      })).toContain(SAMPLE);
      if (virtual) {
        await page.evaluate(() => {
          localStorage.setItem("nr:experimentalReadonlyRendering", "true");
          window.dispatchEvent(new Event("nine-rings:readonly-rendering-change"));
        });
      }
      await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
      const renderedBody = page.locator(virtual ? ".vr-body" : ".editor-content").last();
      await expect(renderedBody).toContainText(SAMPLE);
      return { body: renderedBody };
    });
    const points = await body.evaluate((element, selected) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const offset = (node.textContent ?? "").indexOf(selected);
        if (offset < 0) continue;
        const first = document.createRange();
        first.setStart(node, offset);
        first.setEnd(node, offset + 1);
        const last = document.createRange();
        last.setStart(node, offset + selected.length - 1);
        last.setEnd(node, offset + selected.length);
        const start = first.getBoundingClientRect();
        const end = last.getBoundingClientRect();
        return {
          start: { x: start.left + 0.25, y: start.top + start.height / 2 },
          end: { x: end.right - 0.25, y: end.top + end.height / 2 },
          context: { x: (start.left + end.right) / 2, y: start.top + start.height / 2 },
        };
      }
      throw new Error("selection target was not rendered in a single text node");
    }, SELECTED);
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.end.x, points.end.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe(SELECTED);
    // Tauri/WebKit may clear its native selection as the secondary-click
    // context menu opens. The selection captured on pointerup must survive it.
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.mouse.click(points.context.x, points.context.y, { button: "right" });
    const menu = page.locator(virtual ? ".reading-annotation-context" : ".editor-context-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole(virtual ? "menuitem" : "button", { name: virtual ? "添加阅读高亮" : "选中文字并添加阅读标注" })).toBeEnabled();
  });
}

test("只读标注锚点在切换可编辑后跟随编辑，完全删除选区后自动清除", async ({ page }) => {
  const { body } = await createReadonlySelection(page, false);
  await page.locator(".editor-context-menu").getByRole("button", { name: "选中文字并添加阅读标注", exact: true }).click();
  await expect(body.locator("[data-reading-annotation]")).toHaveCount(1);
  await page.getByRole("button", { name: "点击设为可编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror").last();
  await editor.getByText(SAMPLE).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await expect.poll(async () => page.evaluate(async () => {
    const { listReadingAnnotations } = await import(/* @vite-ignore */ "/src/lib/reading-annotations.ts");
    return (await listReadingAnnotations(localStorage.getItem("nr:lastNote")!)).length;
  })).toBe(0);
});
