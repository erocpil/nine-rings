import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });
test("PDF 快速往返滚动后只提交当前页，离屏画布释放", async ({
  page,
  browserName,
}) => {
  test.setTimeout(60000);
  if (browserName === "chromium") {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  const pdf = await PDFDocument.create();
  for (let i = 1; i <= 60; i++)
    pdf.addPage([600, 800]).drawText(`Unique page ${i}`, { x: 40, y: 720 });
  await page.goto("/");
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^阅读资料库/ }).click();
  await page
    .locator('input[type="file"][accept="application/pdf,.pdf"]')
    .setInputFiles({
      name: "scroll-stress.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await pdf.save()),
    });
  const reader = page.getByLabel("PDF 阅读器", { exact: true });
  await expect(reader).toBeVisible();
  await page.getByRole("button", { name: "PDF 阅读设置", exact: true }).click();
  await page.getByRole("button", { name: "纵向", exact: true }).click();
  await page
    .getByRole("button", { name: "关闭 PDF 阅读设置", exact: true })
    .click();
  const viewport = page.locator(".pdf-page-viewport");
  await expect(
    page
      .locator(".pdf-text-layer")
      .filter({ hasText: "Unique page 1" })
      .first(),
  ).toBeVisible();
  await viewport.evaluate(async (element) => {
    const old = [...element.querySelectorAll("canvas")];
    for (const target of [
      25, 3, 48, 8, 58, 12, 40, 4, 52, 20, 3, 25, 3, 40, 20,
    ]) {
      element
        .querySelector(`[data-pdf-page="${target}"].pdf-page-surface`)!
        .scrollIntoView({ block: "start" });
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // Keep references alive to verify explicit release rather than GC timing.
    Object.assign(window, { __oldPdfCanvases: old });
  });
  const target = page.locator('.pdf-page-surface[data-pdf-page="20"]');
  await expect(target.locator(".pdf-text-layer")).toContainText(
    "Unique page 20",
  );
  await expect
    .poll(() =>
      target.locator("canvas").getAttribute("data-pdf-render-signature"),
    )
    .not.toBeNull();
  await expect(reader).toBeVisible();
  await expect(page.locator(".pdf-reader-error")).toHaveCount(0);
  expect(await viewport.locator("canvas").count()).toBeLessThanOrEqual(4);
  expect(
    await page.evaluate(() => {
      const old = (
        window as unknown as { __oldPdfCanvases: HTMLCanvasElement[] }
      ).__oldPdfCanvases;
      const retained = old.filter(
        (canvas) => !canvas.isConnected && canvas.width > 0,
      );
      return (
        retained.length <= 6 &&
        retained.reduce(
          (pixels, canvas) => pixels + canvas.width * canvas.height,
          0,
        ) <= 12_000_000
      );
    }),
  ).toBe(true);
  await expect(reader).toHaveAttribute("data-pdf-scroll-quality", "full");
  await expect(target.locator("canvas")).not.toHaveAttribute(
    "data-pdf-render-signature",
    /:preview$/,
  );
  await page
    .locator('.pdf-page-surface[data-pdf-page="30"]')
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await expect(target.locator("canvas")).toHaveCount(0);
  await expect(target.locator(".pdf-page-preview")).toHaveAttribute(
    "src",
    /^data:image\/jpeg/,
  );
  await expect(
    page.locator('.pdf-page-surface[data-pdf-page="30"] .pdf-text-layer'),
  ).toContainText("Unique page 30");
  await target.evaluate((element) =>
    element.scrollIntoView({ block: "start" }),
  );
  await expect(target.locator("canvas")).toHaveAttribute(
    "data-pdf-render-source",
    "cache",
  );
  await expect(target.locator(".pdf-text-layer")).toContainText(
    "Unique page 20",
  );
  await page
    .getByRole("button", { name: "关闭 PDF 阅读器", exact: true })
    .tap();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("nr:reader-diagnostics:v1") ?? "[]").at(
          -1,
        ).event,
    ),
  ).toBe("close-request");
  await page.reload();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("nr:reader-diagnostics:v1") ?? "[]").at(
          -1,
        ).event,
    ),
  ).toBe("boot");
});

test("PDF 解析尚未完成时返回会终止加载 Worker", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const state = { active: 0 };
    Object.assign(window, { __pdfWorkerTest: state });
    window.Worker = class extends NativeWorker {
      private blocked: boolean;
      private stopped = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.blocked = String(url).includes("pdf");
        if (this.blocked) state.active++;
      }
      // Keep the PDF handshake pending, modeling a slow startup/parse.
      postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        if (!this.blocked)
          super.postMessage(message, options as StructuredSerializeOptions);
      }
      terminate() {
        if (this.blocked && !this.stopped) state.active--;
        this.stopped = true;
        super.terminate();
      }
    };
  });
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Pending parse");
  await page.goto("/");
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^阅读资料库/ }).click();
  await page
    .locator('input[type="file"][accept="application/pdf,.pdf"]')
    .setInputFiles({
      name: "pending.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await pdf.save()),
    });
  const count = () =>
    page.evaluate(
      () =>
        (window as unknown as { __pdfWorkerTest: { active: number } })
          .__pdfWorkerTest.active,
    );
  await expect.poll(count).toBe(1);
  await expect(page.getByText("正在打开 PDF…", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "关闭 PDF 阅读器", exact: true })
    .tap();
  await expect.poll(count).toBe(0);
  await expect(page.getByLabel("PDF 阅读器", { exact: true })).toHaveCount(0);
});
