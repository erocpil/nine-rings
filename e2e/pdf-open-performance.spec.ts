import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/reader-test";
import { createPdfFixture } from "./helpers/reader-fixtures";

declare global {
  interface Window {
    pdfOpenGate: { seen: string[]; release: (fail?: boolean) => void };
    releasePdfAnnotations: () => void;
  }
}

// Gate real PDF.js worker requests, not elapsed-time thresholds. This verifies
// that independent work can proceed even when a slow phase has not finished.
async function gateWorker(page: Page, actions: string[]) {
  await page.addInitScript((heldActions) => {
    const post = Worker.prototype.postMessage;
    const pending: ((fail: boolean) => void)[] = [];
    let held = true;
    window.pdfOpenGate = {
      seen: [],
      release(fail = false) {
        held = false;
        pending.splice(0).forEach(send => send(fail));
      },
    };
    Worker.prototype.postMessage = function (...args: Parameters<Worker["postMessage"]>) {
      const message = args[0] as { action?: string; callbackId?: number; sourceName?: string; targetName?: string };
      if (message.action) window.pdfOpenGate.seen.push(message.action);
      if (held && message.action && heldActions.includes(message.action)) {
        pending.push((fail) => {
          if (fail) {
            this.dispatchEvent(new MessageEvent("message", { data: {
              sourceName: message.targetName, targetName: message.sourceName,
              callback: 2, callbackId: message.callbackId,
              reason: { name: "UnknownErrorException", message: "metadata test failure" },
            } }));
          } else post.apply(this, args);
        });
        return;
      }
      post.apply(this, args);
    };
  }, actions);
}

async function importPdf(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "PDF / EPUB 阅读", exact: true }).click();
  await page.locator('input[accept="application/pdf,.pdf"]').setInputFiles({
    name: "opening.pdf", mimeType: "application/pdf", buffer: createPdfFixture(),
  });
}

for (const fail of [false, true]) {
  test(`PDF 批注读取${fail ? "失败可清理并重试" : "与解析并行，完成后才开放编辑"}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await gateWorker(page, []);
    await page.addInitScript((fail) => {
      const getAll = IDBIndex.prototype.getAll;
      let held = true;
      const pending: (() => void)[] = [];
      window.releasePdfAnnotations = () => {
        held = false;
        pending.splice(0).forEach(deliver => deliver());
      };
      IDBIndex.prototype.getAll = function (...args) {
        if (held && fail && this.objectStore.name === "highlights") {
          throw new Error("annotation test failure");
        }
        const request = getAll.apply(this, args);
        if (["highlights", "bookmarks"].includes(this.objectStore.name)) {
          request.addEventListener("success", (event) => {
            if (!held) return;
            event.stopImmediatePropagation();
            pending.push(() => request.dispatchEvent(new Event("success")));
          });
        }
        return request;
      };
    }, fail);
    await importPdf(page);
    if (fail) {
      await expect(page.locator(".pdf-reader-error")).toContainText("annotation test failure");
    } else {
      await expect.poll(() => page.evaluate(() => window.pdfOpenGate.seen)).toContain("GetDocRequest");
      await expect(page.locator('canvas[data-pdf-ready="true"]')).toHaveCount(0);
    }
    await page.evaluate(() => window.releasePdfAnnotations());
    if (fail) await page.getByRole("button", { name: "重试打开", exact: true }).click();
    await expect(page.locator(".pdf-page-surface canvas")).toHaveAttribute("data-pdf-ready", "true");
    await expect(page.locator(".pdf-text-layer")).toContainText("Nine Rings PDF MVP");
    expect(errors).toEqual([]);
  });
}

test("PDF 文字提取尚未完成时已开始绘图，两层仍同时提交", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await gateWorker(page, ["GetTextContent"]);
  await importPdf(page);
  await expect.poll(() => page.evaluate(() => window.pdfOpenGate.seen)).toContain("GetTextContent");
  await expect.poll(() => page.evaluate(() => window.pdfOpenGate.seen)).toContain("GetOperatorList");
  await expect(page.locator('canvas[data-pdf-ready="true"]')).toHaveCount(0);
  await page.evaluate(() => window.pdfOpenGate.release());
  await expect(page.locator(".pdf-page-surface canvas")).toHaveAttribute("data-pdf-ready", "true");
  await expect(page.locator(".pdf-text-layer")).toContainText("Nine Rings PDF MVP");
  expect(errors).toEqual([]);
});

for (const fail of [false, true]) {
  test(`PDF 目录${fail ? "失败" : "缓慢"}不阻塞打开、阅读与翻页`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await gateWorker(page, ["GetOutline", "GetPageLabels"]);
    await importPdf(page);
    await expect.poll(() => page.evaluate(() => window.pdfOpenGate.seen)).toContain("GetOutline");
    await expect.poll(() => page.evaluate(() => window.pdfOpenGate.seen)).toContain("GetPageLabels");
    await expect(page.locator(".pdf-page-surface canvas")).toHaveAttribute("data-pdf-ready", "true");
    await expect(page.getByText("正在打开 PDF…", { exact: true })).toHaveCount(0);
    await page.getByLabel("PDF 页码", { exact: true }).fill("2");
    await page.getByLabel("PDF 页码", { exact: true }).press("Enter");
    await expect(page.locator(".pdf-text-layer")).toContainText("Second page searchable target");
    await page.evaluate(fail => window.pdfOpenGate.release(fail), fail);
    if (fail) await expect(page.getByText(/部分目录信息加载失败/)).toBeVisible();
    await expect(page.locator(".pdf-reader-error")).toHaveCount(0);
    await page.getByRole("button", { name: "关闭 PDF 阅读器", exact: true }).click();
    await page.getByRole("button", { name: "继续阅读", exact: true }).click();
    await expect(page.locator(".pdf-text-layer")).toContainText("Second page searchable target");
    expect(errors).toEqual([]);
  });
}

test("PDF 目录仍在加载时关闭并重开，不残留旧任务或错误", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await gateWorker(page, ["GetOutline", "GetPageLabels"]);
  await importPdf(page);
  await expect.poll(() => page.evaluate(() => window.pdfOpenGate.seen)).toContain("GetPageLabels");
  await expect(page.locator(".pdf-page-surface canvas")).toHaveAttribute("data-pdf-ready", "true");
  await page.getByRole("button", { name: "关闭 PDF 阅读器", exact: true }).click();
  // Dispatch late metadata failures to the old (terminated) worker instance.
  await page.evaluate(() => window.pdfOpenGate.release(true));
  await page.getByRole("button", { name: "继续阅读", exact: true }).click();
  await expect(page.locator(".pdf-page-surface canvas")).toHaveAttribute("data-pdf-ready", "true");
  await expect(page.locator(".pdf-text-layer")).toContainText("Nine Rings PDF MVP");
  await expect(page.getByText(/部分目录信息加载失败/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
