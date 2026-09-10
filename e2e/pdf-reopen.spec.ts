import { expect, test } from "./helpers/reader-test";
import { createPdfFixture } from "./helpers/reader-fixtures";
import { openMobileReadingLibrary } from "./helpers/mobile-reading";

test("PDF 重开缓存不受 Worker 转移影响，进度顺序保存且冷启动和备份可用", async ({ page }) => {
  await page.goto("/");
  const bytes = Array.from(createPdfFixture());
  const result = await page.evaluate(async bytes => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const lib = await load("/src/lib/pdf-library.ts");
    const backups = await load("/src/lib/reading-backup.ts");
    const entry = await lib.importLocalPdf(new File([new Uint8Array(bytes)], "repeat.pdf", { type: "application/pdf" }));
    const first = await lib.loadLocalPdf(entry.id);
    structuredClone(first.data, { transfer: [first.data] });
    const save = lib.updateLocalPdfProgress(entry.id, { page: 2, zoom: 1.2, fitWidth: false, pageCount: 2 });
    const second = await lib.loadLocalPdf(entry.id);
    await save;
    const exported = await backups.exportReadingBackup("pdf", entry.id);
    await backups.restoreReadingBackup(entry.id, backups.parseReadingBackup(exported), true);
    await first.release();
    await lib.resetPdfLibraryConnectionForTests();
    const cold = await lib.loadLocalPdf(entry.id);
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open("nine_rings_pdf_library"); req.onsuccess = () => resolve(req.result); });
    const metadata = await new Promise<Record<string, unknown>>(resolve => { const req = db.transaction("documents").objectStore("documents").get(entry.id); req.onsuccess = () => resolve(req.result); });
    db.close();
    await lib.deleteLocalPdf(entry.id);
    await second.release(); // A late release must not resurrect a deleted file.
    const deleted = await lib.getLocalPdf(entry.id);
    return { transferred: first.data.byteLength, page: second.entry.page, coldPage: cold.entry.page, metadataOnly: !("blob" in metadata),
      data: Array.from(new Uint8Array(second.data)), coldData: Array.from(new Uint8Array(cold.data)), deleted,
      backupHasBinary: /"(?:blob|bytes)"/.test(exported) };
  }, bytes);
  expect(result).toEqual({ transferred: 0, page: 2, coldPage: 2, metadataOnly: true, data: bytes, coldData: bytes, deleted: null, backupHasBinary: false });
});

test("PDF v2 迁移后无需旧 Blob，迁移失败保留原书与进度", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async bytes => {
    const db = await new Promise<IDBDatabase>(resolve => {
      const req = indexedDB.open("nine_rings_pdf_library", 2);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("documents", { keyPath: "id" });
        for (const name of ["highlights", "bookmarks"]) req.result.createObjectStore(name, { keyPath: "id" }).createIndex("pdfId", "pdfId");
      };
      req.onsuccess = () => resolve(req.result);
    });
    const record = { id: "legacy", name: "legacy.pdf", size: bytes.length, mimeType: "application/pdf",
      importedAt: "2026-09-10", lastOpenedAt: "2026-09-10", page: 2, zoom: 1.2,
      blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }) };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("documents", "readwrite"); tx.objectStore("documents").put(record);
      tx.objectStore("documents").put({ ...record, id: "broken" });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    db.close();
    const load = (path: string) => import(/* @vite-ignore */ path);
    const lib = await load("/src/lib/pdf-library.ts");
    await lib.loadLocalPdf("legacy");
    await lib.resetPdfLibraryConnectionForTests();
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async () => { throw new DOMException("The object can not be found here.", "NotFoundError"); };
    try {
      const reopened = await lib.loadLocalPdf("legacy");
      let failure = "";
      try { await lib.loadLocalPdf("broken"); } catch (reason) { failure = String(reason); }
      return { page: reopened.entry.page, failure, retained: (await lib.listLocalPdfs()).length };
    } finally { Blob.prototype.arrayBuffer = read; }
  }, Array.from(createPdfFixture()));
  expect(result.page).toBe(2);
  expect(result.failure).toContain("读取 PDF 原文件失败");
  expect(result.failure).toContain("NotFoundError");
  expect(result.retained).toBe(2);
});

test("手机 PDF 翻页后立即关闭重开，后台返回和刷新均保留最新进度", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await openMobileReadingLibrary(page);
  const library = page.getByRole("region", { name: "阅读资料库", exact: true });
  await expect(library).toBeVisible();
  await library.locator('input[accept="application/pdf,.pdf"]').setInputFiles({ name: "repeat.pdf", mimeType: "application/pdf", buffer: createPdfFixture() });
  const text = page.locator(".pdf-text-layer");
  await expect(text.first()).toContainText("Nine Rings PDF MVP");
  for (let cycle = 0; cycle < 4; cycle++) {
    const target = cycle % 2 === 0 ? 2 : 1;
    await page.getByLabel("PDF 页码", { exact: true }).fill(String(target));
    await page.getByLabel("PDF 页码", { exact: true }).press("Enter");
    await page.getByRole("button", { name: "关闭 PDF 阅读器", exact: true }).click();
    await expect(library).toBeVisible();
    await library.getByRole("button", { name: "继续阅读", exact: true }).click();
    await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue(String(target));
    await expect(text.first()).toContainText(target === 2 ? "Second page searchable target" : "Nine Rings PDF MVP");
  }
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(text.first()).toContainText("Nine Rings PDF MVP");
  await page.getByRole("button", { name: "关闭 PDF 阅读器", exact: true }).click();
  await expect(library).toBeVisible();
  await page.reload();
  await openMobileReadingLibrary(page);
  await library.getByRole("button", { name: "继续阅读", exact: true }).click();
  await expect(text.first()).toContainText("Nine Rings PDF MVP");
});
