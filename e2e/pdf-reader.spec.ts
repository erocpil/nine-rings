import { expect, test } from "@playwright/test";

import { createPdfFixture } from "./helpers/reader-fixtures";

test("本地 PDF 从阅读资料库导入后在独立阅读器打开并可再次访问", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 500 });
  await page.addInitScript(() => {
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: async function requestFullscreen(this: Element) {
        fullscreenElement = this;
        document.dispatchEvent(new Event("fullscreenchange"));
      },
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: async () => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "PDF / EPUB 阅读", exact: true }).click();

  await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({
    name: "nine-rings-mvp.pdf",
    mimeType: "application/pdf",
    buffer: createPdfFixture(),
  });

  const reader = page.getByLabel("PDF 阅读器", { exact: true });
  const viewport = page.locator(".pdf-page-viewport");
  await expect(reader).toBeVisible();
  await expect(page.locator(".pdf-reader-title")).toHaveText("nine-rings-mvp.pdf");
  await expect.poll(() => page.locator(".pdf-page-viewport canvas").getAttribute("width")).not.toBe("0");
  await expect(page.getByLabel("PDF 页码")).toHaveValue("1");
  await expect(page.getByText("/ 2", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "进入全屏阅读" }).click();
  await expect(page.getByRole("button", { name: "退出全屏阅读" })).toBeVisible();
  await expect(reader).toHaveClass(/pdf-reader-fullscreen/);
  await expect(reader).toHaveClass(/pdf-fullscreen-controls-hidden/, { timeout: 2000 });
  await viewport.click({ position: { x: 20, y: 20 } });
  await expect(reader).not.toHaveClass(/pdf-fullscreen-controls-hidden/);
  await viewport.click({ position: { x: 20, y: 20 } });
  await expect(reader).toHaveClass(/pdf-fullscreen-controls-hidden/);
  await viewport.click({ position: { x: 20, y: 20 } });
  await page.getByRole("button", { name: "退出全屏阅读" }).click();
  await expect(page.getByRole("button", { name: "进入全屏阅读" })).toBeVisible();
  await expect(reader).toBeVisible();

  await page.evaluate(() => {
    delete (Element.prototype as unknown as { requestFullscreen?: () => Promise<void> }).requestFullscreen;
    delete (Element.prototype as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen;
    delete (document as unknown as { exitFullscreen?: () => Promise<void> }).exitFullscreen;
    delete (document as unknown as { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen;
  });
  await page.getByRole("button", { name: "进入全屏阅读" }).click();
  await expect(reader).toHaveClass(/pdf-reader-immersive/);
  await expect(page.getByRole("button", { name: "退出全屏阅读" })).toBeVisible();
  await page.getByRole("button", { name: "退出全屏阅读" }).click();
  await expect(reader).not.toHaveClass(/pdf-reader-immersive/);
  await expect(reader).toBeVisible();

  const doubleClickSurface = page.locator(".pdf-page-surface").first();
  const doubleClickPoint = { x: 120, y: 70 };
  const anchorBeforeZoom = await doubleClickSurface.evaluate((element, point) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.left + point.x,
      y: bounds.top + point.y,
      ratioX: point.x / bounds.width,
      ratioY: point.y / bounds.height,
    };
  }, doubleClickPoint);
  const canvasWidthBeforeZoom = await doubleClickSurface.locator("canvas").getAttribute("width");
  await doubleClickSurface.dblclick({ position: doubleClickPoint });
  await expect(page.getByRole("button", { name: "适宽", includeHidden: true })).not.toHaveClass(/active/);
  await expect.poll(() => doubleClickSurface.locator("canvas").getAttribute("width"))
    .not.toBe(canvasWidthBeforeZoom);
  await expect.poll(() => doubleClickSurface.evaluate((element, anchor) => {
    const bounds = element.getBoundingClientRect();
    const currentX = bounds.left + anchor.ratioX * bounds.width;
    const currentY = bounds.top + anchor.ratioY * bounds.height;
    const viewport = element.parentElement!;
    // A page shorter than the viewport stays centered; scroll bounds can make
    // preserving the exact pointer position impossible. Check the reachable anchor.
    const left = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, viewport.scrollLeft + currentX - anchor.x));
    const top = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, viewport.scrollTop + currentY - anchor.y));
    return Math.max(Math.abs(left - viewport.scrollLeft), Math.abs(top - viewport.scrollTop));
  }, anchorBeforeZoom)).toBeLessThan(3);
  await doubleClickSurface.dblclick({ position: doubleClickPoint });
  await expect(page.getByRole("button", { name: "适宽", includeHidden: true })).toHaveClass(/active/);

  const initialSurfaceWidth = await page.locator(".pdf-page-surface").evaluate((element) => element.clientWidth);
  await viewport.evaluate((element) => {
    const touch = (identifier: number, clientX: number) => ({
      identifier,
      target: element,
      clientX,
      clientY: 180,
      screenX: clientX,
      screenY: 180,
      pageX: clientX,
      pageY: 180,
      radiusX: 1,
      radiusY: 1,
      rotationAngle: 0,
      force: 1,
    });
    const dispatch = (type: string, touches: ReturnType<typeof touch>[], changedTouches = touches) => {
      // WebKit does not expose a constructible Touch; match the touch-event
      // shape without replacing browser APIs or the reader gesture handlers.
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } });
      element.dispatchEvent(event);
    };
    dispatch("touchstart", [touch(1, 150), touch(2, 250)]);
    dispatch("touchmove", [touch(1, 180), touch(2, 220)]);
    dispatch("touchend", [], [touch(1, 180), touch(2, 220)]);
  });
  await expect(page.getByRole("button", { name: "适宽", includeHidden: true })).not.toHaveClass(/active/);
  await expect.poll(() => page.locator(".pdf-page-surface").evaluate((element) => element.clientWidth)).toBeLessThan(initialSurfaceWidth);
  await page.getByRole("button", { name: "PDF 阅读设置", exact: true }).click();
  await page.getByRole("button", { name: "适宽" }).click();
  await page.getByRole("button", { name: "关闭 PDF 阅读设置", exact: true }).click();

  const selectableText = page.locator(".pdf-text-layer span").filter({ hasText: "Nine Rings PDF MVP" }).first();
  await expect(selectableText).toBeAttached();
  const selectedText = await selectableText.evaluate((span) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(span);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString();
  });
  expect(selectedText).toContain("Nine Rings PDF MVP");
  await expect(page.getByRole("button", { name: "高亮", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "高亮", exact: true }).click();
  await expect(page.locator(".pdf-annotation-highlight")).toContainText("Nine Rings PDF MVP");

  await page.getByRole("button", { name: "添加第 1 页书签" }).click();
  await expect(page.getByRole("button", { name: "取消第 1 页书签" })).toBeVisible();
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await page.getByRole("button", { name: "书签 1", exact: true }).click();
  await expect(page.getByLabel("PDF 目录").getByText("第 1 页", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "关闭目录" }).click();

  const swipe = async (fromX: number, toX: number) => viewport.evaluate((element, points) => {
    const touch = (clientX: number) => ({
      identifier: 1,
      target: element,
      clientX,
      clientY: 200,
      screenX: clientX,
      screenY: 200,
      pageX: clientX,
      pageY: 200,
      radiusX: 1,
      radiusY: 1,
      rotationAngle: 0,
      force: 1,
    });
    const start = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperties(start, { touches: { value: [touch(points.fromX)] }, changedTouches: { value: [touch(points.fromX)] } });
    element.dispatchEvent(start);
    const end = new Event("touchend", { bubbles: true, cancelable: true });
    Object.defineProperties(end, { touches: { value: [] }, changedTouches: { value: [touch(points.toX)] } });
    element.dispatchEvent(end);
  }, { fromX, toX });
  await swipe(280, 120);
  await expect(page.getByLabel("PDF 页码")).toHaveValue("2");
  await swipe(120, 280);
  await expect(page.getByLabel("PDF 页码")).toHaveValue("1");

  // The reader is a workspace pane; its shortcuts require focus in that pane.
  await page.getByLabel("PDF 页码", { exact: true }).focus();
  await page.keyboard.press("Control+f");
  await expect(page.getByLabel("搜索 PDF")).toBeFocused();
  await page.getByLabel("搜索 PDF").fill("Nine Rings");
  await page.getByRole("button", { name: "下一个搜索结果" }).click();
  await expect(page.getByText("1/1 · 第 1 页", { exact: true })).toBeVisible();
  await expect(page.locator(".pdf-search-current")).toHaveText("Nine Rings");

  await page.getByLabel("搜索 PDF").fill("searchable target");
  await page.getByRole("button", { name: "下一个搜索结果" }).click();
  await expect(page.getByLabel("PDF 页码")).toHaveValue("2");
  await expect(page.getByText("1/1 · 第 2 页", { exact: true })).toBeVisible();

  await reader.getByRole("button", { name: "目录", exact: true }).click();
  await expect(page.getByLabel("PDF 目录")).toBeVisible();
  await expect(page.getByRole("button", { name: "页面" })).toBeVisible();
  await page.getByRole("button", { name: "页面" }).click();
  await expect(page.locator(".pdf-page-directory button")).toHaveCount(2);

  await page.getByTitle("返回 Nine Rings").click();
  await expect(reader).toHaveCount(0);
  await page.getByRole("button", { name: "继续阅读", exact: true }).click();
  await expect(page.getByLabel("PDF 阅读器", { exact: true })).toBeVisible();
  const excerptSource = page.locator(".pdf-text-layer span").filter({ hasText: "Second page searchable target" }).first();
  await expect(excerptSource).toBeAttached();
  await excerptSource.evaluate((span) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(span);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await expect(page.getByRole("button", { name: "摘录到笔记" })).toBeVisible();
  await page.getByRole("button", { name: "摘录到笔记" }).click();
  // Desktop excerpts keep the reading pane alongside the new note.
  await expect(reader).toBeVisible();
  await expect(page.locator(".note-title")).toHaveValue("PDF 摘录 · nine-rings-mvp.pdf · 第 2 页");
  await page.getByRole("button", { name: "PDF · 2" }).click();
  await expect(page.getByLabel("PDF 阅读器", { exact: true })).toBeVisible();
  await expect(page.getByLabel("PDF 页码")).toHaveValue("2");
  await expect(page.locator(".pdf-highlight-target")).toContainText("Second page searchable target");

  await page.getByRole("button", { name: "目录", exact: true }).click();
  const pdfOutline = page.getByLabel("PDF 目录");
  await pdfOutline.getByRole("button", { name: "批注 2", exact: true }).click();
  await pdfOutline.getByRole("button", { name: "删除第 2 页批注" }).click();
  await page.getByTitle("返回 Nine Rings").click();
  await page.getByRole("button", { name: "PDF · 2" }).click();
  await expect(page.getByLabel("PDF 页码")).toHaveValue("2");
  await expect(page.locator(".pdf-highlight-target")).toContainText("Second page searchable target");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "添加第 2 页书签" })).toBeVisible();
});
