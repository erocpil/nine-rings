import { expect, test } from "@playwright/test";
import { createPdfFixture } from "./helpers/reader-fixtures";

test("横向 PDF 居中且高清画布不被缩略图覆盖", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^阅读资料库/ }).click();
  await page.locator('input[accept="application/pdf,.pdf"]').setInputFiles({
    name: "horizontal.pdf", mimeType: "application/pdf", buffer: createPdfFixture(),
  });
  const surface = page.locator('.pdf-page-surface[data-pdf-mode="horizontal"]');
  await expect(surface.locator("canvas")).toHaveAttribute("data-pdf-ready", "true");
  await expect(surface.locator(".pdf-page-preview")).toBeAttached();
  const geometry = await surface.evaluate(el => {
    const page = el.getBoundingClientRect();
    const viewport = el.parentElement!.getBoundingClientRect();
    return { x: (page.left + page.right - viewport.left - viewport.right) / 2,
      y: (page.top + page.bottom - viewport.top - viewport.bottom) / 2 };
  });
  expect(Math.abs(geometry.x)).toBeLessThan(2);
  expect(Math.abs(geometry.y)).toBeLessThan(2);
  // Removing the preview must not change any pixels of a finished page.
  const rendered = await surface.screenshot();
  await surface.locator(".pdf-page-preview").evaluate(el => { (el as HTMLElement).style.visibility = "hidden"; });
  expect(await surface.screenshot()).toEqual(rendered);

  // Exercise the loading/error container's geometry independently of download speed.
  const centered = await page.locator(".pdf-page-viewport").evaluate(viewport => {
    const surface = viewport.querySelector<HTMLElement>(".pdf-page-surface")!;
    surface.style.display = "none";
    const message = document.createElement("div");
    message.className = "pdf-reader-message";
    message.textContent = "正在打开 PDF…";
    viewport.append(message);
    const a = message.getBoundingClientRect(), b = viewport.getBoundingClientRect();
    message.remove(); surface.style.display = "";
    return { x: (a.left + a.right - b.left - b.right) / 2, y: (a.top + a.bottom - b.top - b.bottom) / 2 };
  });
  expect(Math.abs(centered.x)).toBeLessThan(2);
  expect(Math.abs(centered.y)).toBeLessThan(2);
});
