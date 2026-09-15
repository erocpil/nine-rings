import { PDFDocument } from "pdf-lib";
import { expect, test } from "./helpers/reader-test";
import { createEpubFixture } from "./helpers/reader-fixtures";

test.use({ deviceScaleFactor: 2 });

for (const format of ["pdf", "epub"] as const) {
  test(`桌面 ${format} 阅读分栏拖到最右后可连续拖回`, async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts");
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
      const note = await api.notes.create({ title: "长文档拖动回归", date: useNotesStore.getState().currentDate,
        storagePath: "tests/reader-resize", content: { ops: Array.from({ length: 300 }, (_, i) => ({ insert: `段落 ${i}：${"正文需要在阅读分栏缩放时保持内容和编辑状态。".repeat(6)}\n` })) } });
      useNotesStore.getState().selectNote(note);
    });
    await expect(page.locator(".note-title")).toHaveValue("长文档拖动回归");
    await page.getByRole("button", { name: "PDF / EPUB 阅读", exact: true }).click();
    if (format === "pdf") {
      const document = await PDFDocument.create();
      for (let i = 1; i <= 4; i++) {
        const pdfPage = document.addPage([600, 840]);
        pdfPage.drawText(`Resize page ${i}`, { x: 30, y: 790 });
        for (let line = 0; line < 45; line++) pdfPage.drawText("Readable text while resizing the desktop workspace.", { x: 30, y: 760 - line * 15, size: 10 });
      }
      await page.locator('input[accept="application/pdf,.pdf"]').setInputFiles({ name: "resize.pdf", mimeType: "application/pdf", buffer: Buffer.from(await document.save()) });
      await expect(page.locator(".pdf-text-layer").first()).toContainText("Resize page 1");
      await page.getByRole("button", { name: "PDF 阅读设置", exact: true }).click();
      await page.getByRole("button", { name: "纵向", exact: true }).click();
      await page.getByRole("button", { name: "关闭 PDF 阅读设置", exact: true }).click();
    } else {
      await page.locator('input[accept="application/epub+zip,.epub"]').setInputFiles({ name: "resize.epub", mimeType: "application/epub+zip", buffer: createEpubFixture() });
      await expect(page.frameLocator(".epub-chapter-frame").getByRole("heading", { name: "第一章" })).toBeVisible();
    }
    const sidebar = page.locator(".app-sidebar");
    const width = () => sidebar.evaluate(el => el.getBoundingClientRect().width);
    const divider = page.locator(".sidebar-divider");
    await divider.evaluate(el => el.addEventListener("pointerdown", event => {
      (el as HTMLElement).dataset.testPointerId = String((event as PointerEvent).pointerId);
    }));
    const drag = async (x: number, interruption?: "capture" | "blur") => {
      const box = (await divider.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 200);
      await page.mouse.down();
      const editorWidth = await page.locator(".app-main").evaluate(el => el.getBoundingClientRect().width);
      const layout = () => page.locator(".desktop-reader-panel").evaluate(panel => {
        const dimensions = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return [rect.width, rect.height];
        };
        const iframe = panel.querySelector<HTMLIFrameElement>("iframe");
        return {
          reader: dimensions(panel),
          toolbar: dimensions(panel.querySelector(".reader-toolbar")!),
          content: dimensions(panel.querySelector(".pdf-page-viewport, .epub-reading-viewport")!),
          pages: [...panel.querySelectorAll(".pdf-page-surface")].map(dimensions),
          chapter: iframe ? [iframe.contentWindow!.innerWidth, iframe.contentWindow!.innerHeight, iframe.contentDocument!.body.scrollHeight] : null,
        };
      });
      const initialLayout = await layout();
      const canvas = page.locator('.pdf-page-surface[data-pdf-page="1"] canvas');
      const signature = format === "pdf" ? await canvas.getAttribute("data-pdf-render-signature") : null;
      await page.mouse.move(x, box.y + 200, { steps: 20 });
      expect(await layout()).toEqual(initialLayout);
      expect(await page.locator(".app-main").evaluate(el => el.getBoundingClientRect().width)).toBe(editorWidth);
      if (format === "pdf") {
        await expect(page.locator(".pdf-reader")).toHaveAttribute("data-pdf-resizing", "true");
        expect(await canvas.getAttribute("data-pdf-render-signature")).toBe(signature);
      }
      if (interruption === "capture") {
        await divider.evaluate(el => el.releasePointerCapture(Number((el as HTMLElement).dataset.testPointerId)));
        await page.mouse.move(x - 1, box.y + 200);
      } else if (interruption === "blur") {
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      }
      if (interruption) await expect(page.locator("body")).not.toHaveCSS("cursor", "col-resize");
      await page.mouse.up();
      await expect(page.locator("body")).not.toHaveClass(/app-sidebar-dragging/);
      await expect.poll(() => sidebar.evaluate(el => {
        const panel = el.querySelector(".desktop-reader-panel")!;
        return Math.abs(panel.getBoundingClientRect().width - el.clientWidth);
      })).toBeLessThanOrEqual(1);
      expect(await page.locator("body").evaluate(el => [
        el.style.getPropertyValue("--sidebar-drag-reader-width"),
        el.style.getPropertyValue("--sidebar-drag-reader-height"),
        el.style.getPropertyValue("--sidebar-drag-editor-width"),
      ])).toEqual(["", "", ""]);
      if (format === "pdf") {
        // Releasing the splitter must resume a sharp render at the final size,
        // rather than keeping the temporary frozen layout indefinitely.
        await expect.poll(() => page.locator(".pdf-page-viewport").evaluate(viewport => {
          const rendered = viewport.querySelector<HTMLCanvasElement>('.pdf-page-surface[data-pdf-page="1"] canvas');
          return rendered?.dataset.pdfReady === "true"
            && rendered.dataset.pdfRenderSignature?.split(":")[1] === String(viewport.clientWidth);
        })).toBe(true);
      }
    };
    for (let cycle = 0; cycle < 3; cycle++) {
      await drag(1278, cycle === 1 ? "capture" : cycle === 2 ? "blur" : undefined);
      await expect.poll(width).toBeGreaterThan(1200);
      expect(await page.locator(".app-main").evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(320);
      expect(await page.locator(".app-body").evaluate(el => el.scrollLeft)).toBe(0);
      await drag(700);
      await expect.poll(width).toBeLessThan(700);
      await expect.poll(width).toBeGreaterThan(600);
      await expect(page.locator(".ProseMirror")).toBeVisible();
      expect(errors).toEqual([]);
    }
    if (format === "pdf") await expect(page.locator(".pdf-text-layer").first()).toContainText("Resize page 1");
    else await expect(page.frameLocator(".epub-chapter-frame").getByRole("heading", { name: "第一章" })).toBeVisible();
    await page.getByRole("button", { name: format === "pdf" ? "关闭 PDF 阅读器" : "关闭 EPUB 阅读器", exact: true }).click();
    await expect(page.getByRole("region", { name: "阅读资料库", exact: true })).toBeVisible();
    await expect(page.locator(".ProseMirror")).toContainText("段落 299");
  });
}

test("阅读资料库拖动期间冻结布局，取消拖动后恢复", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.getByRole("button", { name: "PDF / EPUB 阅读", exact: true }).click();
  const library = page.getByRole("region", { name: "阅读资料库", exact: true });
  await expect(library).toBeVisible();
  const dimensions = () => library.evaluate(el => [el.clientWidth, el.clientHeight]);
  const initialDimensions = await dimensions();
  const divider = page.locator(".sidebar-divider");
  await divider.evaluate(el => el.addEventListener("pointerdown", event => {
    (el as HTMLElement).dataset.testPointerId = String((event as PointerEvent).pointerId);
  }));
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(1000, box.y + 200, { steps: 20 });
  expect(await dimensions()).toEqual(initialDimensions);
  await divider.evaluate(el => el.dispatchEvent(new PointerEvent("pointercancel", {
    pointerId: Number((el as HTMLElement).dataset.testPointerId), bubbles: true,
  })));
  await expect(page.locator("body")).not.toHaveClass(/app-sidebar-dragging/);
  await page.mouse.up();
  await expect.poll(async () => (await dimensions())[0]).toBeGreaterThan(initialDimensions[0]);
  await expect(page.locator("body")).not.toHaveCSS("cursor", "col-resize");
  await expect(page.locator(".ProseMirror")).toBeVisible();
});
