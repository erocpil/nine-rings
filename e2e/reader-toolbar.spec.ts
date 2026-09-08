import { expect, test, type Page } from "@playwright/test";
import { createEpubFixture, createPdfFixture } from "./helpers/reader-fixtures";

test.use({ hasTouch: true });

async function openBook(page: Page, format: "PDF" | "EPUB") {
  await page.goto("/");
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^阅读资料库/ }).click();
  const mime = format === "PDF" ? "application/pdf" : "application/epub+zip";
  await page.locator(`input[type=file][accept="${mime},.${format.toLowerCase()}"]`).setInputFiles({
    name: `toolbar.${format.toLowerCase()}`, mimeType: mime,
    buffer: format === "PDF" ? createPdfFixture() : createEpubFixture(),
  });
  await expect(page.getByLabel(`${format} 阅读器`, { exact: true })).toBeVisible();
  if (format === "PDF") await expect(page.locator(".pdf-text-layer span").first()).toBeAttached();
  else await expect(page.locator(".epub-chapter-frame").contentFrame().getByRole("heading", { name: "第一章" })).toBeVisible();
}

for (const format of ["PDF", "EPUB"] as const) {
  test(`${format} 工具栏适配窄屏，设置互斥且不改变正文视口或重建内容`, async ({ page }, testInfo) => {
    await openBook(page, format);
    const toolbar = page.locator(".reader-toolbar");
    const surface = page.locator(format === "PDF" ? ".pdf-page-surface" : ".epub-chapter-frame").first();
    const original = await surface.elementHandle();
    if (!original) throw new Error("missing reader surface");
    const viewport = page.locator(format === "PDF" ? ".pdf-page-viewport" : ".epub-reading-viewport");
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expect.poll(() => toolbar.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      if (width <= 390) expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(100);
      const buttons = toolbar.locator(".reader-toolbar-main button, .reader-toolbar-controls button");
      for (const button of await buttons.all()) {
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      }
      const before = await viewport.boundingBox();
      await page.getByRole("button", { name: `${format} 阅读设置`, exact: true }).click();
      const settings = page.getByRole("region", { name: `${format} 阅读设置`, exact: true });
      await expect(settings).toBeVisible();
      const box = await settings.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(800);
      // Width preferences add a section: vertical scrolling is intentional,
      // but all controls must remain reachable without horizontal overflow.
      expect(await settings.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await settings.getByRole("button").last().scrollIntoViewIfNeeded();
      await expect(settings.getByRole("button").last()).toBeInViewport();
      expect(await viewport.boundingBox()).toEqual(before);
      if (width === 390) await page.screenshot({ path: testInfo.outputPath(`${format}-settings.png`) });
      await page.getByRole("button", { name: `${format} 搜索`, exact: true }).click();
      await expect(settings).toBeHidden();
      await expect(page.getByLabel(`搜索 ${format}`, { exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("region", { name: `${format} 搜索`, exact: true })).toBeHidden();
      await expect(page.getByRole("button", { name: `${format} 搜索`, exact: true })).toBeFocused();
      await expect(page.getByLabel(`${format} 阅读器`, { exact: true })).toBeVisible();
      expect(await original.evaluate((element) => element.isConnected)).toBe(true);
    }
    await original.dispose();
  });
}

test("PDF 批注工具按需展开，绘制后可完成并查看、隐藏和导出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openBook(page, "PDF");
  await expect(page.getByRole("button", { name: "矩形", exact: true })).toBeHidden();
  const trigger = page.getByRole("button", { name: "PDF 批注工具", exact: true });
  await trigger.click();
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await expect(page.getByRole("region", { name: "PDF 批注工具", exact: true })).toBeHidden();
  await expect(page.locator(".reader-active-tool")).toContainText("矩形");
  const box = await page.locator(".pdf-page-surface").boundingBox();
  await page.mouse.move(box!.x + 40, box!.y + 40);
  await page.mouse.down();
  await page.mouse.move(box!.x + 140, box!.y + 90, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(".pdf-page-annotation-square")).toHaveCount(1);
  await page.getByRole("button", { name: "完成批注", exact: true }).click();
  await expect(page.locator(".pdf-annotation-overlay.drawing")).toHaveCount(0);
  await expect(page.locator(".reader-active-tool")).toHaveCount(0);
  // Finishing drawing removes a toolbar row. ResizeObserver then requests a
  // new text layer; selecting the old span before that commit loses the range.
  // Wait for the actual viewport's render, not merely an attached old span.
  await expect.poll(() => page.locator(".pdf-page-viewport").evaluate((viewport) => {
    const canvas = viewport.querySelector<HTMLCanvasElement>(".pdf-page-surface canvas");
    const signature = canvas?.dataset.pdfRenderSignature?.split(":");
    return signature?.length === 4 && signature[1] === String(viewport.clientWidth)
      && signature[2] === String(viewport.clientHeight) && signature[3] === "fit-width";
  })).toBe(true);
  await page.locator(".pdf-text-layer span").first().evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByRole("button", { name: "高亮", exact: true }).click();
  await expect(page.locator(".pdf-annotation-highlight")).toHaveCount(1);
  await trigger.click();
  await page.getByRole("button", { name: "隐藏高亮", exact: true }).click();
  await expect(page.locator(".pdf-annotation-highlight")).toHaveCount(0);
  await page.getByRole("button", { name: "显示高亮", exact: true }).click();
  await expect(page.locator(".pdf-annotation-highlight")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出标注 PDF", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  await page.getByTitle("查看和管理 PDF 批注").click();
  await expect(page.getByRole("region", { name: "PDF 批注工具", exact: true })).toBeHidden();
  await expect(page.locator(".pdf-annotation-directory")).toBeVisible();
});

test("EPUB 手机设置关闭与人工修复入口不吞点击，搜索保留查询", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openBook(page, "EPUB");
  const trigger = page.getByRole("button", { name: "EPUB 阅读设置", exact: true });
  await trigger.click();
  await page.getByRole("button", { name: "管理 EPUB 人工断行修复" }).click();
  await expect(page.getByRole("dialog", { name: "EPUB 人工断行修复", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭 EPUB 人工断行修复" }).click();
  await trigger.click();
  await page.getByRole("button", { name: "关闭阅读工具面板", exact: true }).click({ position: { x: 12, y: 550 } });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "EPUB 搜索", exact: true }).click();
  await page.getByLabel("搜索 EPUB", { exact: true }).fill("阅读进度");
  await page.getByLabel("下一个 EPUB 搜索结果").click();
  await expect(page.locator(".epub-chapter-controls")).toContainText("2/2");
  await page.getByLabel("搜索 EPUB", { exact: true }).press("ArrowLeft");
  await expect(page.locator(".epub-chapter-controls")).toContainText("2/2");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "EPUB 搜索", exact: true }).click();
  await expect(page.getByLabel("搜索 EPUB", { exact: true })).toHaveValue("阅读进度");
});
