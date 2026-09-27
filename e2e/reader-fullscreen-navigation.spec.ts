import type { Locator } from "@playwright/test";
import { expect, test } from "./helpers/reader-test";
import { createEpubFixture, createPdfFixture } from "./helpers/reader-fixtures";
import { openMobileReadingLibrary } from "./helpers/mobile-reading";

async function expectFloatingPanel(toolbar: Locator, panel: Locator) {
  await expect(panel).toBeVisible();
  await expect.poll(async () => {
    const bar = await toolbar.boundingBox();
    const box = await panel.boundingBox();
    return Boolean(bar && box && box.y >= bar.y + bar.height);
  }).toBe(true);
  await expect.poll(() => panel.evaluate(element => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
}

for (const wide of [false, true]) {
  test.describe(wide ? "桌面全屏导航" : "手机全屏导航", () => {
    test.use({ hasTouch: !wide });
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(wide ? { width: 1280, height: 800 } : { width: 390, height: 844 });
      // Desktop Fullscreen API lifecycle without depending on headless window UI.
      await page.addInitScript(() => {
        let current: Element | null = null;
        Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => current });
        Element.prototype.requestFullscreen = async function () {
          current = this; document.dispatchEvent(new Event("fullscreenchange"));
        };
        document.exitFullscreen = async () => {
          current = null; document.dispatchEvent(new Event("fullscreenchange"));
        };
      });
      await page.goto("/");
      if (wide) await page.getByRole("button", { name: "PDF / EPUB 阅读", exact: true }).click();
      else await openMobileReadingLibrary(page);
    });

    test("PDF 目录回退页列表、书签切换与搜索在全屏均可用", async ({ page }, testInfo) => {
      await page.getByRole("region", { name: "阅读资料库", exact: true }).locator('input[accept="application/pdf,.pdf"]').setInputFiles({
        name: "navigation.pdf", mimeType: "application/pdf", buffer: createPdfFixture(),
      });
      await expect(page.locator(".pdf-text-layer").first()).toContainText("Nine Rings PDF MVP");
      const toolbar = page.locator(".reader-toolbar");
      const directory = toolbar.getByRole("button", { name: "目录", exact: true });
      await toolbar.getByRole("button", { name: "添加第 1 页书签" }).click();
      await toolbar.getByRole("button", { name: "进入全屏阅读", exact: true }).click();
      await directory.click();
      await expect(directory).toHaveAttribute("aria-expanded", "true");
      const outline = page.locator(".pdf-outline");
      await expectFloatingPanel(toolbar, outline);
      await expect(outline.getByRole("button", { name: "页面", exact: true })).toHaveClass(/active/);
      await page.mouse.move(385, 700);
      await page.waitForTimeout(1300);
      await expect(toolbar).toHaveCSS("opacity", "1");
      await expect(directory).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await page.screenshot({ path: testInfo.outputPath("fullscreen-outline.png") });
      if (!wide) {
        await page.setViewportSize({ width: 740, height: 390 });
        await expectFloatingPanel(toolbar, outline);
        await page.setViewportSize({ width: 390, height: 844 });
        await expectFloatingPanel(toolbar, outline);
      }
      await directory.click();
      await expect(outline).toHaveCount(0);
      const bookmarks = toolbar.getByRole("button", { name: "打开 PDF 书签" });
      await bookmarks.click();
      await expectFloatingPanel(toolbar, outline);
      await expect(bookmarks).toHaveAttribute("aria-expanded", "true");
      await bookmarks.click();
      await expect(bookmarks).toHaveAttribute("aria-expanded", "false");
      await directory.click();
      await page.keyboard.press("Escape");
      await expect(outline).toHaveCount(0);
      await toolbar.getByRole("button", { name: "PDF 搜索", exact: true }).click();
      const search = toolbar.locator('[data-reader-panel="search"]');
      await expectFloatingPanel(toolbar, search);
      await expect(search.locator("input")).toBeFocused();
      await search.locator("input").fill("Second page");
      await search.locator("input").press("Enter");
      await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
      await page.keyboard.press("Escape");
      await expect(search).toBeHidden();
      await expect(page.locator(".pdf-reader")).toHaveClass(/pdf-reader-fullscreen/);
      await toolbar.getByRole("button", { name: "PDF 搜索", exact: true }).press("ControlOrMeta+f");
      await expect(search).toBeVisible();
      await expect(page.locator(".pdf-reader")).toHaveClass(/pdf-reader-fullscreen/);
      await page.keyboard.press("Escape");
      await toolbar.getByRole("button", { name: "退出全屏阅读", exact: true }).click();
      await expect(page.locator(".pdf-reader-title")).toBeVisible();
    });

    test("EPUB 全屏目录书签可收起、打开时固定工具栏且不重排正文", async ({ page }, testInfo) => {
      await page.getByRole("region", { name: "阅读资料库", exact: true }).locator('input[accept="application/epub+zip,.epub"]').setInputFiles({
        name: "navigation.epub", mimeType: "application/epub+zip", buffer: createEpubFixture(),
      });
      const reader = page.getByRole("region", { name: "EPUB 阅读器", exact: true });
      const frame = page.frameLocator(".epub-reader .epub-chapter-frame");
      const tapFrame = async () => {
        await frame.locator("body").evaluate((body) => {
          body.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
          body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
      };
      await expect(frame.getByRole("heading", { name: "第一章" })).toBeVisible();
      const toolbar = reader.locator(".reader-toolbar");
      await toolbar.getByRole("button", { name: "进入 EPUB 专注模式" }).click();
      await expect(reader).toHaveClass(/epub-reader-focus/);
      await expect(toolbar).toBeHidden();
      await expect(frame.getByRole("heading", { name: "第一章" })).toBeVisible();
      const before = await page.locator(".epub-chapter-frame").boundingBox();
      expect(before).not.toBeNull();
      await tapFrame();
      await expect(toolbar).toBeVisible();
      const directory = toolbar.getByRole("button", { name: "EPUB 目录", exact: true });
      await directory.click();
      await expect(directory).toHaveAttribute("aria-expanded", "true");
      await expectFloatingPanel(toolbar, page.locator(".epub-outline"));
      await page.mouse.move(385, 700);
      await page.waitForTimeout(1300);
      await expect(toolbar).toBeVisible();
      expect(await page.locator(".epub-chapter-frame").boundingBox()).toEqual(before);
      await expect(directory).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await page.screenshot({ path: testInfo.outputPath("fullscreen-outline.png") });
      if (!wide) {
        await page.setViewportSize({ width: 740, height: 390 });
        await expectFloatingPanel(toolbar, page.locator(".epub-outline"));
        await page.setViewportSize({ width: 390, height: 844 });
        await expectFloatingPanel(toolbar, page.locator(".epub-outline"));
      }
      // Same trigger closes; clicking the frame also dismisses the directory.
      await directory.click();
      await expect(directory).toHaveAttribute("aria-expanded", "false");
      await directory.click();
      await expect(directory).toHaveAttribute("aria-expanded", "true");
      await tapFrame();
      await expect(page.locator(".epub-outline:visible")).toHaveCount(0);
      await expect(reader).toHaveClass(/epub-reader-focus/);
      await expect(toolbar).toBeHidden();
      await tapFrame();
      const bookmarks = toolbar.getByRole("button", { name: "打开 EPUB 书签" });
      await bookmarks.click();
      const panel = toolbar.getByRole("dialog", { name: "EPUB 书签" });
      await expectFloatingPanel(toolbar, panel);
      await panel.getByRole("button", { name: "添加当前位置书签" }).click();
      await expect(panel.getByRole("button", { name: "取消本章书签" })).toBeVisible();
      await page.mouse.move(385, 700);
      await page.waitForTimeout(1300);
      await expect(toolbar).toBeVisible();
      await bookmarks.click();
      await expect(panel).toBeHidden();
      await toolbar.getByRole("button", { name: "EPUB 搜索", exact: true }).click();
      await expectFloatingPanel(toolbar, toolbar.locator('[data-reader-panel="search"]'));
      await page.keyboard.press("Escape");
      await toolbar.getByRole("button", { name: "退出 EPUB 专注模式" }).click();
      await expect(page.locator(".pdf-reader-title")).toBeVisible();
    });
  });
}
