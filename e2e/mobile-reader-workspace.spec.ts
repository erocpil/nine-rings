import { expect, test } from "./helpers/reader-test";
import { createEpubFixture, createPdfFixture } from "./helpers/reader-fixtures";
import { openMobileReadingLibrary } from "./helpers/mobile-reading";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

for (const format of ["pdf", "epub"] as const) {
  test(`手机非专注展陈中的 ${format} 工具栏完整可点击，关闭恢复外框`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("nine_rings_config", JSON.stringify({
        interface_style: "mono-aware", workspace_layout: "exhibition",
      }));
      localStorage.setItem("nr:focusMode", "false");
    });
    await page.goto("/");
    await expect(page.locator(".exhibition-masthead")).toBeVisible();
    await page.addStyleTag({ content: ":root { --safe-top: 44px; --safe-bottom: 34px; }" });
    await openMobileReadingLibrary(page);
    const mime = format === "pdf" ? "application/pdf" : "application/epub+zip";
    await page.getByRole("region", { name: "阅读资料库", exact: true }).locator(`input[accept="${mime},.${format}"]`).setInputFiles({
      name: `mobile.${format}`, mimeType: mime,
      buffer: format === "pdf" ? createPdfFixture() : createEpubFixture(),
    });
    if (format === "pdf") await expect(page.locator(".pdf-text-layer").first()).toContainText("Nine Rings PDF MVP");
    else await expect(page.frameLocator(".epub-chapter-frame").getByRole("heading", { name: "第一章" })).toBeVisible();
    const close = page.getByRole("button", { name: `关闭 ${format.toUpperCase()} 阅读器`, exact: true });
    for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size);
      await expect.poll(() => close.evaluate(el => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return r.top >= 0 && r.bottom <= innerHeight && !!top && el.contains(top);
      })).toBe(true);
      await expect(page.locator(".exhibition-masthead")).toBeHidden();
      await expect(page.locator(".exhibition-overview")).toBeHidden();
    }
    await close.click();
    await expect(page.locator(".exhibition-masthead")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("nr:focusMode"))).toBe("false");
  });
}
