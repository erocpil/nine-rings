import { expect, test } from "./helpers/reader-test";
import { createEpubFixture } from "./helpers/reader-fixtures";

test("EPUB 顺序保存、并发打开、冷启动、备份和删除保留一致的数据", async ({ page }) => {
  await page.goto("/");
  const bytes = Array.from(createEpubFixture());
  const result = await page.evaluate(async bytes => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const lib = await load("/src/lib/epub-library.ts");
    const backups = await load("/src/lib/reading-backup.ts");
    const entry = await lib.importLocalEpub(new File([new Uint8Array(bytes)], "repeat.epub", { type: "application/epub+zip" }));
    const [first, second] = await Promise.all([lib.loadLocalEpub(entry.id), lib.loadLocalEpub(entry.id)]);
    const save = lib.updateLocalEpubProgress(entry.id, { chapter: 1, fontSize: 120, theme: "sepia", scrollProgress: .4 });
    const reopened = await lib.loadLocalEpub(entry.id);
    await save;
    const cover = await lib.getLocalEpubCover(entry.id);
    const exported = await backups.exportReadingBackup("epub", entry.id);
    const backup = backups.parseReadingBackup(exported);
    await backups.restoreReadingBackup(entry.id, backup, true);
    const afterRestore = await lib.loadLocalEpub(entry.id);
    await lib.resetEpubLibraryConnectionForTests();
    const cold = await lib.loadLocalEpub(entry.id);
    const file = await lib.getLocalEpub(entry.id);
    const copied = Array.from(new Uint8Array(await file.blob.arrayBuffer()));
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open("nine_rings_epub_library"); req.onsuccess = () => resolve(req.result); });
    const metadata = await new Promise<Record<string, unknown>>(resolve => {
      const req = db.transaction("books").objectStore("books").get(entry.id); req.onsuccess = () => resolve(req.result);
    });
    db.close();
    await lib.deleteLocalEpub(entry.id);
    let deleted = false;
    try { await lib.loadLocalEpub(entry.id); } catch { deleted = true; }
    return { shared: first.book === second.book && reopened.book === first.book,
      chapter: reopened.entry.chapter, restored: afterRestore.entry.chapter, cold: cold.entry.chapter,
      cover: Boolean(cover?.size), detached: !("blob" in metadata) && !("coverBlob" in metadata),
      copied, deleted, backupHasBinary: /"(?:blob|bytes|coverBytes)"/.test(exported) };
  }, bytes);
  expect(result).toEqual({ shared: true, chapter: 1, restored: 1, cold: 1, cover: true, detached: true, copied: bytes, deleted: true, backupHasBinary: false });
});

test("EPUB v2 Blob 迁移后不再读取旧句柄，迁移失败保留原记录", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async bytes => {
    const db = await new Promise<IDBDatabase>(resolve => {
      const req = indexedDB.open("nine_rings_epub_library", 2);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("books", { keyPath: "id" });
        for (const name of ["highlights", "bookmarks"]) req.result.createObjectStore(name, { keyPath: "id" }).createIndex("epubId", "epubId");
      };
      req.onsuccess = () => resolve(req.result);
    });
    const record = { id: "legacy", name: "legacy.epub", title: "Legacy", size: bytes.length,
      mimeType: "application/epub+zip", importedAt: "2026-09-10", lastOpenedAt: "2026-09-10",
      chapter: 1, chapterCount: 2, fontSize: 110, theme: "sepia",
      blob: new Blob([new Uint8Array(bytes)], { type: "application/epub+zip" }) };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("books", "readwrite"); tx.objectStore("books").put(record);
      tx.objectStore("books").put({ ...record, id: "broken" });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    db.close();
    const load = (path: string) => import(/* @vite-ignore */ path);
    const lib = await load("/src/lib/epub-library.ts");
    const first = await lib.loadLocalEpub("legacy");
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async () => { throw new DOMException("The object can not be found here.", "NotFoundError"); };
    try {
      await lib.resetEpubLibraryConnectionForTests();
      const reopened = await lib.loadLocalEpub("legacy");
      let failure = "";
      try { await lib.loadLocalEpub("broken"); } catch (error) { failure = String(error); }
      const remaining = await lib.listLocalEpubs();
      return { chapter: first.entry.chapter, reopened: reopened.entry.chapter, failure, retained: remaining.some((entry: { id: string }) => entry.id === "broken") };
    } finally { Blob.prototype.arrayBuffer = read; }
  }, Array.from(createEpubFixture()));
  expect(result.chapter).toBe(1);
  expect(result.reopened).toBe(1);
  expect(result.failure).toContain("读取 EPUB 原文件失败");
  expect(result.failure).toContain("NotFoundError");
  expect(result.retained).toBe(true);
});

test("手机 EPUB 连续关闭重开后显示正文、封面和最新章节", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  // The lower left third opens the reading workspace with the default order.
  await page.locator(".app").evaluate(element => {
    for (const [type, x] of [["touchstart", 2], ["touchmove", 220], ["touchend", 220]] as const) {
      const touch = { identifier: 1, clientX: x, clientY: 700 };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: type === "touchend" ? [] : [touch] }, changedTouches: { value: [touch] } });
      element.dispatchEvent(event);
    }
  });
  const library = page.getByRole("region", { name: "阅读资料库", exact: true });
  await expect(library).toBeVisible();
  await library.locator('input[accept="application/epub+zip,.epub"]').setInputFiles({
    name: "repeat.epub", mimeType: "application/epub+zip", buffer: createEpubFixture(),
  });
  const chapter = page.frameLocator(".epub-chapter-frame");
  await expect(chapter.getByRole("heading", { name: "第一章" })).toBeVisible();
  await page.getByRole("button", { name: "下一章", exact: true }).click();
  for (let cycle = 0; cycle < 4; cycle++) {
    await expect(chapter.getByRole("heading", { name: "第二章" })).toBeVisible();
    await page.getByRole("button", { name: "关闭 EPUB 阅读器", exact: true }).click();
    await expect(library).toBeVisible();
    await expect.poll(() => library.locator(".reader-library-cover img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await library.getByRole("button", { name: "继续阅读", exact: true }).click();
  }
  await expect(chapter.getByRole("heading", { name: "第二章" })).toBeVisible();
  await expect(page.locator(".pdf-reader-error")).toHaveCount(0);
});
