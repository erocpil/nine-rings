import { expect, test } from "@playwright/test";

function createPdfFixture(): Buffer {
  const stream = "BT /F1 18 Tf 36 90 Td (Nine Rings PDF MVP) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n`;
  source += "0000000000 65535 f \n";
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, "ascii");
}

test("本地 PDF 从设置导入后在独立阅读器打开并可再次访问", async ({ page }) => {
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
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^数据与导入/ }).click();

  await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({
    name: "nine-rings-mvp.pdf",
    mimeType: "application/pdf",
    buffer: createPdfFixture(),
  });

  const reader = page.getByLabel("PDF 阅读器");
  await expect(reader).toBeVisible();
  await expect(page.locator(".pdf-reader-title")).toHaveText("nine-rings-mvp.pdf");
  await expect.poll(() => page.locator(".pdf-page-viewport canvas").getAttribute("width")).not.toBe("0");
  await expect(page.getByLabel("PDF 页码")).toHaveValue("1");
  await expect(page.getByText("/ 1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "进入全屏阅读" }).click();
  await expect(page.getByRole("button", { name: "退出全屏阅读" })).toBeVisible();
  await expect(reader).toHaveClass(/pdf-reader-fullscreen/);
  await page.keyboard.press("Escape");
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
  await page.keyboard.press("Escape");
  await expect(reader).not.toHaveClass(/pdf-reader-immersive/);
  await expect(reader).toBeVisible();

  await page.getByLabel("搜索 PDF").fill("Nine Rings");
  await page.getByRole("button", { name: "查找" }).click();
  await expect(page.getByText("第 1 页", { exact: true })).toBeVisible();

  await page.getByTitle("返回 Nine Rings").click();
  await expect(reader).toHaveCount(0);
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^数据与导入/ }).click();
  await expect(page.getByRole("button", { name: /打开 nine-rings-mvp.pdf/ })).toBeVisible();
  await page.getByRole("button", { name: /打开 nine-rings-mvp.pdf/ }).click();
  await expect(page.getByLabel("PDF 阅读器")).toBeVisible();
});
