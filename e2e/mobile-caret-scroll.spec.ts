import { expect, test, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }));
}

async function keyboard(page: Page, open: boolean, offsetTop = 0) {
  await page.evaluate(({ open, offsetTop }) => {
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: open ? 430 : window.innerHeight });
    Object.defineProperty(window.visualViewport!, "offsetTop", { configurable: true, value: offsetTop });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  }, { open, offsetTop });
  await settle(page);
}

async function prepare(page: Page, focus = false) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  if (focus) await page.getByRole("button", { name: "专注模式", exact: true }).click();
  await page.locator(".ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: "doc", content: Array.from({ length: 100 }, (_, i) => ({
      type: "paragraph", content: [{ type: "text", text: `第 ${i + 1} 段用于验证移动光标与键盘滚动。` }],
    })) });
    editor.commands.setTextSelection(editor.view.posAtDOM(element.children[20], 0) + 2);
    editor.view.focus();
  });
  await keyboard(page, true);
}

async function scrollToTarget(page: Page, index: number, inset: number) {
  return page.locator(".ProseMirror").evaluate((element, { index, inset }) => {
    const root = element.closest<HTMLElement>(".note-editor-scroll")!;
    const target = element.children[index];
    const sticky = root.querySelector<HTMLElement>(":scope > .note-editor-sticky");
    const top = Math.max(root.getBoundingClientRect().top,
      sticky && getComputedStyle(sticky).position === "sticky" ? sticky.getBoundingClientRect().bottom : 0);
    root.dispatchEvent(new Event("touchstart", { bubbles: true }));
    root.scrollTop += target.getBoundingClientRect().top - top - inset;
    return root.scrollTop;
  }, { index, inset });
}

for (const { blur, focus } of [{ blur: false, focus: false }, { blur: true, focus: false }, { blur: false, focus: true }]) {
  test(`键盘收起再滚动，延迟同步的新点按选区不追踪旧光标（blur=${blur}, focus=${focus}）`, async ({ page }) => {
    await prepare(page, focus);
    await keyboard(page, false);
    if (blur) await page.locator(".ProseMirror").evaluate(element => (element as HTMLElement).blur());
    const before = await scrollToTarget(page, 65, 50);
    await settle(page);
    // Native mobile selection can arrive AFTER focus and viewport resize. Keep
    // that ordering explicit: a synthetic tap does not set the DOM caret yet.
    await page.locator(".ProseMirror").evaluate(element => {
      const target = element.children[65];
      const rect = target.getBoundingClientRect();
      const pointer = { bubbles: true, pointerId: 7, pointerType: "touch", isPrimary: true,
        clientX: rect.left + 20, clientY: rect.top + 10 };
      target.dispatchEvent(new PointerEvent("pointerdown", pointer));
      target.dispatchEvent(new Event("touchstart", { bubbles: true }));
      target.dispatchEvent(new PointerEvent("pointerup", pointer));
      target.dispatchEvent(new Event("touchend", { bubbles: true }));
      (element as HTMLElement & { editor: Editor }).editor.view.focus();
    });
    await keyboard(page, true);
    await page.waitForTimeout(100);
    expect(Math.abs(await page.locator(".note-editor-scroll").evaluate(el => el.scrollTop) - before)).toBeLessThanOrEqual(2);
    await page.locator(".ProseMirror").evaluate(element => {
      const target = element.children[65].firstChild!;
      window.getSelection()!.collapse(target, 3);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await settle(page);
    await expect.poll(() => page.locator(".ProseMirror").evaluate(element =>
      (element as HTMLElement & { editor: Editor }).editor.state.selection.$from.parent.textContent,
    )).toContain("第 66 段");
    expect(Math.abs(await page.locator(".note-editor-scroll").evaluate(el => el.scrollTop) - before)).toBeLessThanOrEqual(2);
  });
}

test("键盘已打开，点按可见首行不增加滚动留白，也不响应视口平移追踪旧光标", async ({ page }) => {
  await prepare(page);
  const before = await scrollToTarget(page, 60, 1);
  await settle(page);
  const box = (await page.locator(".ProseMirror > p").nth(60).boundingBox())!;
  await page.touchscreen.tap(box.x + 35, box.y + 10);
  await settle(page);
  expect(Math.abs(await page.locator(".note-editor-scroll").evaluate(el => el.scrollTop) - before)).toBeLessThanOrEqual(2);
  const afterScroll = await scrollToTarget(page, 80, 50);
  await page.evaluate(() => window.visualViewport!.dispatchEvent(new Event("scroll")));
  await settle(page);
  expect(Math.abs(await page.locator(".note-editor-scroll").evaluate(el => el.scrollTop) - afterScroll)).toBeLessThanOrEqual(2);
});

test("键盘缩小可视区时被遮挡的新光标仍可见，继续输入正常", async ({ page }) => {
  await prepare(page);
  await keyboard(page, false);
  await scrollToTarget(page, 65, 450);
  const box = (await page.locator(".ProseMirror > p").nth(65).boundingBox())!;
  await page.touchscreen.tap(box.x + 30, box.y + 10);
  await keyboard(page, true);
  await expect.poll(() => page.locator(".ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    const caret = editor.view.coordsAtPos(editor.state.selection.head);
    const root = element.closest(".note-editor-scroll")!.getBoundingClientRect();
    return caret.top >= root.top && caret.bottom <= Math.min(root.bottom, window.visualViewport!.height);
  })).toBe(true);
  await page.keyboard.type("NEW");
  await expect(page.locator(".ProseMirror > p").nth(65)).toContainText("NEW");
});

test("键盘收起后残留的 visualViewport 偏移不保留键盘布局", async ({ page }) => {
  await prepare(page);
  await keyboard(page, true, 100);
  await expect(page.locator("html")).toHaveClass(/web-keyboard-open/);
  await keyboard(page, false, 100);
  await expect(page.locator("html")).not.toHaveClass(/web-keyboard-open/);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--app-visual-viewport-offset-top"))).toBe("0px");
});

test("键盘已打开时拖动阅读不被布局变化拉回旧光标，下一次输入恢复跟随", async ({ page }) => {
  await prepare(page);
  const before = await page.locator(".ProseMirror").evaluate(element => {
    const root = element.closest<HTMLElement>(".note-editor-scroll")!;
    const target = element.children[20];
    const pointer = { bubbles: true, pointerId: 9, pointerType: "touch", isPrimary: true, clientX: 100, clientY: 300 };
    target.dispatchEvent(new PointerEvent("pointerdown", pointer));
    target.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientY: 200 }));
    target.dispatchEvent(new PointerEvent("pointercancel", pointer));
    root.scrollTop += 700;
    window.visualViewport!.dispatchEvent(new Event("scroll"));
    // A suggestion row changes the keyboard height while the user is reading.
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 400 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
    return root.scrollTop;
  });
  await settle(page);
  expect(Math.abs(await page.locator(".note-editor-scroll").evaluate(el => el.scrollTop) - before)).toBeLessThanOrEqual(2);
  await page.keyboard.type("RESUME");
  await expect.poll(() => page.locator(".ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    const caret = editor.view.coordsAtPos(editor.state.selection.head);
    const root = element.closest(".note-editor-scroll")!.getBoundingClientRect();
    return caret.top >= root.top && caret.bottom <= root.bottom;
  })).toBe(true);
});

test("移动端容器尺寸轻微抖动不恢复旧阅读锚点", async ({ page }) => {
  await prepare(page);
  // Keep the selection near block 21, then start reading much farther down.
  // The resize is deliberately sent before the settled-scroll capture runs:
  // this is the same ordering produced by iOS keyboard safe-area updates.
  const before = await scrollToTarget(page, 70, 48);
  await page.locator(".note-editor-scroll").evaluate(root => {
    const element = root as HTMLElement;
    const width = element.clientWidth;
    element.style.width = `${width - 1}px`;
    requestAnimationFrame(() => { element.style.width = ""; });
  });
  await settle(page);
  expect(Math.abs(await page.locator(".note-editor-scroll").evaluate(el => el.scrollTop) - before)).toBeLessThanOrEqual(2);
});

test("原生多行选区保留，键盘变化不会将选区折叠或滚回旧光标", async ({ page }) => {
  await prepare(page);
  const before = await scrollToTarget(page, 60, 30);
  await page.locator(".ProseMirror").evaluate(element => {
    window.getSelection()!.setBaseAndExtent(element.children[60].firstChild!, 2, element.children[62].firstChild!, 5);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await settle(page);
  const selected = await page.evaluate(() => window.getSelection()!.toString());
  expect(selected).toContain("第 62 段");
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 400 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await settle(page);
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(selected);
  expect(Math.abs(await page.locator(".note-editor-scroll").evaluate(el => el.scrollTop) - before)).toBeLessThanOrEqual(2);
});
