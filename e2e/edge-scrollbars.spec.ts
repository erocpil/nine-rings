import { expect, test, type Locator } from "@playwright/test";

// Chromium's headless default disables native scrollbar hit testing entirely.
// Exercise the same draggable gutter that desktop users actually interact with.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

async function expectThumb(element: Locator, visible: boolean) {
  const webkit = await element.evaluate(() => CSS.supports("selector(::-webkit-scrollbar)"));
  if (webkit && await element.evaluate(() => CSS.supports("scrollbar-color", "auto"))) {
    // Standard properties must not override the styled WebKit scrollbar and
    // hand its visibility back to the macOS overlay auto-hide timer.
    await expect(element).toHaveCSS("scrollbar-color", "auto");
  } else if (!webkit && await element.evaluate(() => CSS.supports("scrollbar-color", "transparent transparent"))) {
    const assertion = expect(element);
    if (visible) await assertion.not.toHaveCSS("scrollbar-color", "rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)");
    else await assertion.toHaveCSS("scrollbar-color", "rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)");
  }
}

test("桌面仅靠近对应滚动边缘显示，滚动和布局不变", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-edge-scrollbars", "");
  // Deterministic nested panes exercise the same delegated events as dynamically
  // mounted trees, lists, editor NodeViews and dialogs, without scanning the DOM.
  await page.evaluate(() => {
    const panel = document.createElement("div");
    panel.id = "scroll-test";
    panel.style.cssText = "position:fixed;left:100px;top:120px;width:400px;height:400px;overflow:auto;background:white;z-index:99999";
    const inner = document.createElement("div");
    inner.id = "scroll-inner";
    inner.style.cssText = "margin:30px;width:240px;height:160px;overflow:auto";
    const body = document.createElement("div");
    body.style.cssText = "width:700px;height:800px";
    body.textContent = "嵌套代码／引用滚动区域";
    inner.append(body);
    panel.append(inner);
    const tail = document.createElement("div");
    tail.style.height = "1000px";
    panel.append(tail);
    document.body.append(panel);
  });
  const outer = page.locator("#scroll-test"), inner = page.locator("#scroll-inner");
  const dimensions = await inner.evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }));
  const rect = (await inner.boundingBox())!;
  await page.mouse.move(rect.x + 80, rect.y + 60);
  await expect(inner).not.toHaveAttribute("data-scrollbar-visible");
  await expectThumb(inner, false);
  await page.mouse.wheel(0, 50);
  await expect.poll(() => inner.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect(inner).not.toHaveAttribute("data-scrollbar-visible");
  const before = await inner.evaluate(el => el.scrollTop);
  await page.mouse.move(rect.x + rect.width - 10, rect.y + 60);
  await expect(inner).toHaveAttribute("data-scrollbar-visible", "");
  await expectThumb(inner, true);
  await expect(outer).not.toHaveAttribute("data-scrollbar-visible");
  expect(await inner.evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }))).toEqual(dimensions);
  expect(await inner.evaluate(el => el.scrollTop)).toBe(before);
  await page.mouse.down();
  await page.mouse.move(700, 100);
  await expect(inner).toHaveAttribute("data-scrollbar-visible", "");
  await page.mouse.up();
  await expect(inner).not.toHaveAttribute("data-scrollbar-visible");
  await page.mouse.move(rect.x + 70, rect.y + rect.height - 8);
  await expect(inner).toHaveAttribute("data-scrollbar-visible", "");
  const outerRect = (await outer.boundingBox())!;
  await page.mouse.move(outerRect.x + outerRect.width - 8, outerRect.y + 280);
  await expect(outer).toHaveAttribute("data-scrollbar-visible", "");
  await expect(inner).not.toHaveAttribute("data-scrollbar-visible");
  await page.mouse.move(700, 100);
  await expect(outer).not.toHaveAttribute("data-scrollbar-visible");
  await outer.evaluate(el => { el.tabIndex = 0; el.focus(); });
  await page.keyboard.press("PageDown");
  await expect.poll(() => outer.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
});

for (const readonly of [false, true]) {
  test(`${readonly ? "只读" : "编辑"}文本区：原生轨道显示、移出隐藏且可拖动`, async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
    await page.evaluate(async readonly => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
      const note = await api.notes.create({
        title: "滚动条悬停测试", date: "2026-09-19", storagePath: "tests/scrollbar",
        content: { ops: Array.from({ length: 120 }, (_, i) => ({ insert: `第 ${i + 1} 段：鼠标进入右侧轨道时显示滚动条，离开后隐藏。\n` })) },
      });
      useNotesStore.getState().selectNote(await api.notes.update(note.id, { readonly }));
    }, readonly);
    const pane = page.locator(".note-editor-scroll").filter({ visible: true });
    await expect.poll(() => pane.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(1000);
    await pane.evaluate(el => { el.scrollTop = 0; });
    const rect = (await pane.boundingBox())!;
    const dimensions = await pane.evaluate(el => [el.clientWidth, el.clientHeight]);
    const x = rect.x + rect.width - 2, y = rect.y + 80;
    const nativeMouse = async (type: string, clientX = x, buttons = 0) => {
      // Model WKWebView's native gutter delivering mouse events to an ancestor,
      // rather than pointer events whose target is inside the scrollable pane.
      await page.evaluate(({ type, clientX, y, buttons }) => {
        document.body.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY: y, button: 0, buttons }));
      }, { type, clientX, y, buttons });
    };
    await nativeMouse("mousemove", rect.x + 100);
    await expect(pane).not.toHaveAttribute("data-scrollbar-visible");
    await nativeMouse("mousemove");
    await expect(pane).toHaveAttribute("data-scrollbar-visible", "");
    expect(await pane.evaluate(el => [el.clientWidth, el.clientHeight])).toEqual(dimensions);
    expect(await pane.evaluate(el => el.scrollTop)).toBe(0);

    await nativeMouse("mousedown", x, 1);
    await nativeMouse("mousemove", rect.x + 100, 1);
    await expect(pane).toHaveAttribute("data-scrollbar-visible", "");
    await nativeMouse("mouseup", rect.x + 100);
    await expect(pane).not.toHaveAttribute("data-scrollbar-visible");
    await nativeMouse("mousemove");
    await nativeMouse("mousedown", x, 1);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel")));
    await expect(pane).not.toHaveAttribute("data-scrollbar-visible");

    // The actual native scrollbar still owns scrolling; no simulated scroll or
    // custom thumb replaces it, and pointer handlers must not swallow dragging.
    await page.mouse.move(x, rect.y + 12);
    await expect(pane).toHaveAttribute("data-scrollbar-visible", "");
    await page.mouse.down();
    await page.mouse.move(x, rect.y + rect.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
    await page.mouse.move(rect.x + 100, y);
    await expect(pane).not.toHaveAttribute("data-scrollbar-visible");

    await nativeMouse("mousemove");
    await page.evaluate(({ x, y }) => {
      const overlay = document.createElement("div");
      overlay.id = "scrollbar-occluder";
      overlay.style.cssText = `position:fixed;left:${x - 30}px;top:${y - 30}px;width:50px;height:80px;background:white;z-index:99999`;
      document.body.append(overlay);
    }, { x, y });
    await nativeMouse("mousemove");
    await expect(pane).not.toHaveAttribute("data-scrollbar-visible");
    await page.locator("#scrollbar-occluder").evaluate(el => el.remove());
    await nativeMouse("mousemove");
    await expect(pane).toHaveAttribute("data-scrollbar-visible", "");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(pane).not.toHaveAttribute("data-scrollbar-visible");
  });
}

test("手机和高对比模式保留原生滚动条", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-edge-scrollbars");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("html")).toHaveAttribute("data-edge-scrollbars", "");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(page.locator("html")).not.toHaveAttribute("data-edge-scrollbars");
});
