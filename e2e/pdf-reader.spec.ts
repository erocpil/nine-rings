import { expect, test } from "@playwright/test";

function createPdfFixture(): Buffer {
  const firstStream = "BT /F1 18 Tf 36 90 Td (Nine Rings PDF MVP) Tj ET";
  const secondStream = "BT /F1 18 Tf 36 90 Td (Second page searchable target) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(firstStream)} >>\nstream\n${firstStream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    `<< /Length ${Buffer.byteLength(secondStream)} >>\nstream\n${secondStream}\nendstream`,
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

  await page.locator(".pdf-page-surface").dblclick({ position: { x: 120, y: 70 } });
  await expect(page.getByRole("button", { name: "适宽" })).not.toHaveClass(/active/);
  await page.locator(".pdf-page-surface").dblclick({ position: { x: 120, y: 70 } });
  await expect(page.getByRole("button", { name: "适宽" })).toHaveClass(/active/);

  const initialSurfaceWidth = await page.locator(".pdf-page-surface").evaluate((element) => element.clientWidth);
  await viewport.evaluate((element) => {
    const touch = (identifier: number, clientX: number) => new Touch({
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
    element.dispatchEvent(new TouchEvent("touchstart", {
      bubbles: true,
      cancelable: true,
      touches: [touch(1, 150), touch(2, 250)],
    }));
    element.dispatchEvent(new TouchEvent("touchmove", {
      bubbles: true,
      cancelable: true,
      touches: [touch(1, 180), touch(2, 220)],
    }));
    element.dispatchEvent(new TouchEvent("touchend", {
      bubbles: true,
      cancelable: true,
      touches: [],
      changedTouches: [touch(1, 180), touch(2, 220)],
    }));
  });
  await expect(page.getByRole("button", { name: "适宽" })).not.toHaveClass(/active/);
  await expect.poll(() => page.locator(".pdf-page-surface").evaluate((element) => element.clientWidth)).toBeLessThan(initialSurfaceWidth);
  await page.getByRole("button", { name: "适宽" }).click();

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
  await page.evaluate(() => window.getSelection()?.removeAllRanges());

  const swipe = async (fromX: number, toX: number) => viewport.evaluate((element, points) => {
    const touch = (clientX: number) => new Touch({
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
    element.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [touch(points.fromX)] }));
    element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [touch(points.toX)] }));
  }, { fromX, toX });
  await swipe(280, 120);
  await expect(page.getByLabel("PDF 页码")).toHaveValue("2");
  await swipe(120, 280);
  await expect(page.getByLabel("PDF 页码")).toHaveValue("1");

  await page.getByLabel("搜索 PDF").fill("Nine Rings");
  await page.getByRole("button", { name: "下一个搜索结果" }).click();
  await expect(page.getByText("1/1 · 第 1 页", { exact: true })).toBeVisible();
  await expect(page.locator(".pdf-search-current")).toHaveText("Nine Rings");

  await page.getByLabel("搜索 PDF").fill("searchable target");
  await page.getByRole("button", { name: "下一个搜索结果" }).click();
  await expect(page.getByLabel("PDF 页码")).toHaveValue("2");
  await expect(page.getByText("1/1 · 第 2 页", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "目录" }).click();
  await expect(page.getByLabel("PDF 目录")).toBeVisible();
  await expect(page.getByRole("button", { name: "页面" })).toBeVisible();
  await expect(page.locator(".pdf-page-directory button")).toHaveCount(2);

  await page.getByTitle("返回 Nine Rings").click();
  await expect(reader).toHaveCount(0);
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^数据与导入/ }).click();
  await expect(page.getByRole("button", { name: /打开 nine-rings-mvp.pdf/ })).toBeVisible();
  await page.getByRole("button", { name: /打开 nine-rings-mvp.pdf/ }).click();
  await expect(page.getByLabel("PDF 阅读器")).toBeVisible();
});
