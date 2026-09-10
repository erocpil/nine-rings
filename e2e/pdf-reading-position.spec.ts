import { PDFDocument } from "pdf-lib";
import { expect, test } from "./helpers/reader-test";
import { openMobileReadingLibrary } from "./helpers/mobile-reading";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

for (const mode of ["vertical", "horizontal"] as const) {
  test(`PDF ${mode} 重开及刷新保留页码和双向页内位置`, async ({ page }) => {
    test.setTimeout(60000);
    const document = await PDFDocument.create();
    for (let i = 1; i <= 12; i++) document.addPage([600, 300]).drawText(`Position page ${i}`, { x: 30, y: 240 });
    await page.goto("/");
    await page.evaluate(async ({ bytes, mode }) => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const lib = await load("/src/lib/pdf-library.ts");
      const entry = await lib.importLocalPdf(new File([new Uint8Array(bytes)], "position.pdf", { type: "application/pdf" }));
      // Legacy progress has only a page number, no page-relative anchor.
      await lib.updateLocalPdfProgress(entry.id, { page: 4, zoom: 1.5, fitWidth: mode === "vertical", viewMode: mode });
    }, { bytes: Array.from(await document.save()), mode });
    await openMobileReadingLibrary(page);
    const library = page.getByRole("region", { name: "阅读资料库", exact: true });
    const reopen = async () => {
      await library.getByRole("button", { name: "继续阅读", exact: true }).click();
      await expect(page.locator('.pdf-page-surface[data-pdf-page="4"] canvas')).toHaveAttribute("data-pdf-ready", "true");
      await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("4");
      await page.waitForTimeout(650); // Also catch delayed observer/layout-induced page drift.
      await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("4");
    };
    const close = async () => {
      await page.getByRole("button", { name: "关闭 PDF 阅读器", exact: true }).click();
      await expect(library).toBeVisible();
    };
    await reopen();
    for (let cycle = 0; cycle < 3; cycle++) { await close(); await reopen(); }

    if (mode === "vertical") {
      await page.getByRole("button", { name: "PDF 阅读设置", exact: true }).click();
      for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
      await page.getByRole("button", { name: "关闭 PDF 阅读设置", exact: true }).click();
    }
    const viewport = page.locator(".pdf-page-viewport");
    await expect.poll(() => viewport.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(250);
    await viewport.evaluate(el => {
      const surface = el.querySelector<HTMLElement>('.pdf-page-surface[data-pdf-page="4"]')!;
      el.scrollLeft = 210;
      if (el.classList.contains("pdf-page-viewport-vertical")) {
        el.scrollTop += surface.getBoundingClientRect().top - el.getBoundingClientRect().top - 12 + 90;
      }
    });
    await page.waitForTimeout(700);
    const coordinates = () => viewport.evaluate(el => {
      const view = el.getBoundingClientRect(), surface = el.querySelector('.pdf-page-surface[data-pdf-page="4"]')!.getBoundingClientRect();
      return { x: (view.left + el.clientLeft + el.clientWidth / 2 - surface.left) / surface.width,
        y: (view.top + el.clientTop + 12 - surface.top) / surface.height, left: el.scrollLeft };
    });
    const before = await coordinates();
    expect(before.left).toBeGreaterThan(150);
    // Same-page panning must save even without a page-number state update.
    await expect.poll(async () => page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const lib = await load("/src/lib/pdf-library.ts");
      return (await lib.listLocalPdfs())[0].position?.x ?? 0;
    })).toBeCloseTo(before.x, 2);
    for (let cycle = 0; cycle < 3; cycle++) {
      await close();
      if (cycle === 2) { await page.reload(); await openMobileReadingLibrary(page); }
      await reopen();
      const after = await coordinates();
      expect(Math.abs(after.x - before.x)).toBeLessThan(0.01);
      expect(Math.abs(after.y - before.y)).toBeLessThan(0.01);
    }
  });
}
