import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { strToU8, zipSync } from "fflate";

async function fixture(format: "pdf" | "epub") {
  if (format === "pdf") {
    const document = await PDFDocument.create(); document.addPage(); document.addPage();
    return Array.from(await document.save());
  }
  return Array.from(zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
    "book.opf": strToU8('<package><metadata><title>阅读备份测试</title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'),
    "one.xhtml": strToU8('<html><body><p>第一章</p></body></html>'),
    "two.xhtml": strToU8('<html><body><p>第二章阅读位置</p></body></html>'),
  }));
}

for (const format of ["pdf", "epub"] as const) {
  for (const width of [390, 1280]) {
    test(`${format} 单书备份导出、预检、取消与恢复 ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 850 });
      await page.goto("/");
      await expect(page.locator(".ProseMirror")).toBeVisible();
      const ids = await page.evaluate(async ({ bytes, format }) => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const library = await load(`/src/lib/${format}-library.ts`);
        const file = (name: string) => new File([new Uint8Array(bytes)], name, { type: format === "pdf" ? "application/pdf" : "application/epub+zip" });
        if (format === "pdf") {
          const source = await library.importLocalPdf(file("source.pdf"));
          const target = await library.importLocalPdf(file("target.pdf"));
          await library.updateLocalPdfProgress(source.id, { page: 2, pageCount: 2, zoom: 1.25 });
          await library.addLocalPdfBookmark(source.id, 2, "重要页");
          await library.addLocalPdfHighlight({ pdfId: source.id, page: 2, start: 0, end: 3, text: "text", note: "备份备注" });
          return { source: source.id, target: target.id };
        }
        const source = await library.importLocalEpub(file("source.epub"));
        const target = await library.importLocalEpub(file("target.epub"));
        await library.updateLocalEpubProgress(source.id, { chapter: 1, fontSize: 120, theme: "sepia", scrollProgress: .5, chapterProgress: { "two.xhtml": .5 }, smartLineMerge: true, manualLineMerges: [] });
        await library.addLocalEpubBookmark({ epubId: source.id, chapter: 1, chapterPath: "two.xhtml", scrollProgress: .5, label: "重要章节" });
        const highlight = await library.addLocalEpubHighlight(source.id, { chapterPath: "two.xhtml", start: 0, end: 3, exact: "第二章", prefix: "", suffix: "阅读位置" });
        await library.updateLocalEpubHighlight(highlight.id, { note: "备份备注" });
        return { source: source.id, target: target.id };
      }, { bytes: await fixture(format), format });
      await page.getByTitle("设置", { exact: true }).click();
      await page.getByRole("button", { name: /^阅读资料库/ }).click();
      const source = page.locator(`.reader-library-item[data-document-id="${ids.source}"]`);
      const target = page.locator(`.reader-library-item[data-document-id="${ids.target}"]`);
      await source.getByRole("button", { name: /^阅读数据备份 / }).click();
      const panel = page.locator(".reader-backup-panel");
      const downloadPromise = page.waitForEvent("download");
      await panel.getByRole("button", { name: "导出阅读数据", exact: true }).click();
      const download = await downloadPromise;
      const json = await readFile((await download.path())!, "utf8");
      expect(json).not.toContain('"blob"');
      await expect(panel.getByRole("status")).toContainText("已导出");
      await target.getByRole("button", { name: /^阅读数据备份 / }).click();
      const input = panel.getByLabel("阅读备份文件");
      const backupFile = { name: "book.reading.json", mimeType: "application/json", buffer: Buffer.from(json) };
      await input.setInputFiles(backupFile);
      await expect(panel).toContainText("原文件内容匹配");
      await expect(panel.getByRole("checkbox")).not.toBeChecked();
      await panel.getByRole("button", { name: "取消恢复", exact: true }).click();
      await expect(panel.getByRole("button", { name: "确认合并阅读数据" })).toHaveCount(0);
      const invalid = JSON.parse(json); invalid.file.fingerprint = "a".repeat(64);
      await input.setInputFiles({ ...backupFile, buffer: Buffer.from(JSON.stringify(invalid)) });
      await expect(panel.getByRole("alert")).toContainText("原文件内容不一致");
      await input.setInputFiles(backupFile);
      await expect(panel).toContainText("原文件内容匹配");
      await panel.getByRole("checkbox").check();
      await panel.getByRole("button", { name: "确认合并阅读数据", exact: true }).click();
      await expect(panel.getByRole("status")).toContainText("恢复完成：新增 2");
      await expect(panel.getByRole("status")).toContainText("已恢复阅读位置");
      await input.setInputFiles(backupFile);
      await expect(panel).toContainText("原文件内容匹配");
      await panel.getByRole("button", { name: "确认合并阅读数据", exact: true }).click();
      await expect(panel.getByRole("status")).toContainText("跳过重复 2 条");
      if (width === 390) await page.screenshot({ path: testInfo.outputPath(`reading-backup-${format}.png`) });
      await page.reload();
      const restored = await page.evaluate(async ({ format, id }) => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const library = await load(`/src/lib/${format}-library.ts`);
        const book = format === "pdf" ? await library.getLocalPdf(id) : await library.getLocalEpub(id);
        const highlights = format === "pdf" ? await library.listLocalPdfHighlights(id) : await library.listLocalEpubHighlights(id);
        return { position: format === "pdf" ? book.entry.page : book.entry.chapter, count: highlights.length, note: highlights[0].note };
      }, { format, id: ids.target });
      expect(restored).toEqual({ position: format === "pdf" ? 2 : 1, count: 1, note: "备份备注" });
    });
  }
}
