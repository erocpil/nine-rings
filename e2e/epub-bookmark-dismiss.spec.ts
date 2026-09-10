import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { expect, test } from "./helpers/reader-test";
import { createEpubFixture } from "./helpers/reader-fixtures";
import { openMobileReadingLibrary } from "./helpers/mobile-reading";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

for (const fullscreen of [false, true]) {
  test(`EPUB ${fullscreen ? "全屏" : "普通"}书签点击空白只关闭面板，不移动正文或抢焦点`, async ({ page }) => {
    await page.goto("/");
    await openMobileReadingLibrary(page);
    const archive = unzipSync(createEpubFixture());
    archive["OEBPS/chapter-1.xhtml"] = strToU8(strFromU8(archive["OEBPS/chapter-1.xhtml"]).replace("</body>", `${"<p>用于验证书签弹层关闭时的正文滚动位置。</p>".repeat(100)}</body>`));
    await page.locator('input[accept="application/epub+zip,.epub"]').setInputFiles({
      name: "bookmark-dismiss.epub", mimeType: "application/epub+zip", buffer: Buffer.from(zipSync(archive)),
    });
    const toolbar = page.locator(".reader-toolbar");
    const frame = page.frameLocator(".epub-chapter-frame");
    await expect(frame.getByRole("heading", { name: "第一章" })).toBeVisible();
    if (fullscreen) {
      await toolbar.getByRole("button", { name: "进入 EPUB 专注模式" }).click();
      await frame.locator("body").dispatchEvent("click");
    }
    await toolbar.getByRole("button", { name: "打开 EPUB 书签" }).click();
    const panel = page.getByRole("dialog", { name: "EPUB 书签" });
    await expect(panel).toBeVisible();
    await frame.locator("html").evaluate(element => { element.ownerDocument.defaultView!.scrollTo(0, 500); });
    await expect.poll(() => frame.locator("html").evaluate(element => element.ownerDocument.defaultView!.scrollY)).toBe(500);
    const bounds = await page.locator(".epub-chapter-frame").boundingBox();
    // The dismiss surface must not introduce hidden overflow below the reader.
    const backdrop = page.getByRole("button", { name: "关闭阅读工具面板" });
    const backdropBox = (await backdrop.boundingBox())!;
    expect(backdropBox.y + backdropBox.height).toBeLessThanOrEqual(844);
    expect(backdropBox.x).toBe(0);
    expect(backdropBox.width).toBe(390);
    await page.evaluate(() => {
      const original = HTMLElement.prototype.focus;
      Object.assign(window, { readerFocusCalls: [] as string[] });
      HTMLElement.prototype.focus = function (options) {
        (window as unknown as { readerFocusCalls: string[] }).readerFocusCalls.push(this.getAttribute("aria-label") ?? this.tagName);
        original.call(this, options);
      };
    });
    // Check the pressed/hover frame, not just geometry after dismissal. A
    // transparent full-page button must never inherit the toolbar's fill.
    const beforePress = await page.locator(".epub-chapter-frame").screenshot();
    await page.mouse.move(12, 740);
    await expect(backdrop).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(backdrop).toHaveCSS("-webkit-tap-highlight-color", "rgba(0, 0, 0, 0)");
    await page.mouse.down();
    await expect(backdrop).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(backdrop).toHaveCSS("box-shadow", "none");
    await expect(backdrop).toHaveCSS("transform", "none");
    expect(await page.locator(".epub-chapter-frame").screenshot()).toEqual(beforePress);
    await page.mouse.up();
    await expect(panel).toBeHidden();
    await toolbar.getByRole("button", { name: "打开 EPUB 书签" }).click();
    await expect(panel).toBeVisible();
    await page.evaluate(() => { (window as unknown as { readerFocusCalls: string[] }).readerFocusCalls = []; });
    await page.touchscreen.tap(12, 740);
    await expect(panel).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { readerFocusCalls: string[] }).readerFocusCalls)).toEqual([]);
    expect(await page.locator(".epub-chapter-frame").boundingBox()).toEqual(bounds);
    expect(await frame.locator("html").evaluate(element => element.ownerDocument.defaultView!.scrollY)).toBe(500);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    await toolbar.getByRole("button", { name: "打开 EPUB 书签" }).click();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(toolbar.getByRole("button", { name: "打开 EPUB 书签" })).toBeFocused();
  });
}
