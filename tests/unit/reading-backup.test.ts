import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  addLocalPdfBookmark,
  addLocalPdfAnnotation,
  addLocalPdfHighlight,
  importLocalPdf,
  listLocalPdfBookmarks,
  listLocalPdfHighlights,
  getLocalPdf,
  updateLocalPdfHighlight,
  updateLocalPdfProgress,
  resetPdfLibraryConnectionForTests,
} from "../../src/lib/pdf-library";
import {
  listLocalEpubs,
  getLocalEpub,
  addLocalEpubBookmark,
  addLocalEpubHighlight,
  listLocalEpubHighlights,
  resetEpubLibraryConnectionForTests,
  updateLocalEpubProgress,
} from "../../src/lib/epub-library";
import {
  exportReadingBackup,
  previewReadingBackup,
  restoreReadingBackup,
  parseReadingBackup,
} from "../../src/lib/reading-backup";
import {
  fingerprintReadingFile,
  MAX_READING_BACKUP_BYTES,
} from "../../src/lib/reading-backup-format";
import type { LocalEpubEntry } from "../../src/lib/epub-library";

function file(body = "sample", name = "book.pdf") {
  const blob = new Blob([`%PDF-1.7\n${body}\n%%EOF`]);
  Object.defineProperty(blob, "name", { value: name });
  return blob as File;
}

async function clearDB(name: string) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  await resetPdfLibraryConnectionForTests();
  await resetEpubLibraryConnectionForTests();
  await clearDB("nine_rings_pdf_library");
  await clearDB("nine_rings_epub_library");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function seedPdf() {
  const entry = await importLocalPdf(file());
  await updateLocalPdfProgress(entry.id, {
    page: 4,
    zoom: 1.5,
    pageCount: 10,
    lockedWidthRatio: 0.85,
  });
  await addLocalPdfHighlight({
    pdfId: entry.id,
    page: 4,
    start: 0,
    end: 4,
    text: "text",
    note: "备注",
  });
  await addLocalPdfBookmark(entry.id, 4, "第四页");
  return entry;
}

describe("单书阅读备份", () => {
  it("备份不含原文件，可恢复到不同 ID/名称的相同文件，默认保留阅读位置", async () => {
    const source = await seedPdf();
    const json = await exportReadingBackup("pdf", source.id);
    expect(json).not.toContain("blob");
    expect(json).not.toContain("%PDF-");
    const target = await importLocalPdf(file("sample", "renamed.pdf"));
    const backup = await previewReadingBackup("pdf", target.id, json);
    const result = await restoreReadingBackup(target.id, backup);
    expect(result).toMatchObject({ added: 2, skipped: 0, conflicts: 0 });
    expect((await getLocalPdf(target.id))?.entry.page).toBe(1);
    expect((await listLocalPdfHighlights(target.id))[0]).toMatchObject({
      note: "备注",
      pdfId: target.id,
    });
    expect(await restoreReadingBackup(target.id, backup, true)).toMatchObject({
      added: 0,
      skipped: 2,
    });
    expect((await getLocalPdf(target.id))?.entry.page).toBe(4);
    expect((await getLocalPdf(target.id))?.entry.name).toBe("renamed.pdf");
    expect((await getLocalPdf(target.id))?.entry.zoom).toBe(1.5);
    expect((await getLocalPdf(target.id))?.entry.lockedWidthRatio).toBe(0.85);
    await updateLocalPdfProgress(target.id, {
      page: 4,
      zoom: 1,
      lockedWidthRatio: null,
    });
    expect((await getLocalPdf(target.id))?.entry.lockedWidthRatio).toBeNull();
  });

  it("内容变化但名称和大小相同也拒绝，原书签和进度不变", async () => {
    const source = await seedPdf();
    const backup = parseReadingBackup(
      await exportReadingBackup("pdf", source.id),
    );
    const target = await importLocalPdf(file("tamper"));
    await expect(
      previewReadingBackup("pdf", target.id, JSON.stringify(backup)),
    ).rejects.toThrow("原文件内容不一致");
    await expect(restoreReadingBackup(target.id, backup, true)).rejects.toThrow(
      "原文件内容不一致",
    );
    expect(await listLocalPdfBookmarks(target.id)).toHaveLength(0);
    expect((await getLocalPdf(target.id))?.entry.page).toBe(1);
  });

  it("保留本地批注冲突副本，再次导入不会增加副本", async () => {
    const source = await seedPdf();
    const backup = parseReadingBackup(
      await exportReadingBackup("pdf", source.id),
    );
    await updateLocalPdfHighlight(backup.highlights[0].id, {
      note: "本地最新备注",
    });
    expect(await restoreReadingBackup(source.id, backup)).toMatchObject({
      added: 1,
      conflicts: 1,
    });
    expect(
      (await listLocalPdfHighlights(source.id)).map((item) => item.note).sort(),
    ).toEqual(["备注", "本地最新备注"].sort());
    expect(await restoreReadingBackup(source.id, backup)).toMatchObject({
      added: 0,
      skipped: 2,
      conflicts: 0,
    });
  });

  it("图形、箭头和文本框完整导出/恢复", async () => {
    const source = await seedPdf();
    await addLocalPdfAnnotation({
      pdfId: source.id,
      page: 2,
      kind: "arrow",
      start: 0,
      end: 0,
      text: "",
      color: "#ffb300",
      points: { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 },
      note: "箭头",
    });
    await addLocalPdfAnnotation({
      pdfId: source.id,
      page: 2,
      kind: "freeText",
      start: 0,
      end: 0,
      text: "文本框",
      color: "#ffb300",
      rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.2 },
      fontSize: 14,
    });
    const target = await importLocalPdf(file());
    await restoreReadingBackup(
      target.id,
      parseReadingBackup(await exportReadingBackup("pdf", source.id)),
    );
    expect(await listLocalPdfHighlights(target.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "arrow",
          points: { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 },
        }),
        expect.objectContaining({
          kind: "freeText",
          text: "文本框",
          fontSize: 14,
        }),
      ]),
    );
  });

  it("事务中途失败时连同进度和已入队批注全部回滚", async () => {
    const source = await seedPdf();
    const target = await importLocalPdf(file());
    const backup = parseReadingBackup(
      await exportReadingBackup("pdf", source.id),
    );
    const add = IDBObjectStore.prototype.add;
    let calls = 0;
    const spy = vi
      .spyOn(IDBObjectStore.prototype, "add")
      .mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<typeof add>
      ) {
        if (++calls === 2)
          throw new DOMException("模拟空间不足", "QuotaExceededError");
        return add.apply(this, args);
      });
    await expect(restoreReadingBackup(target.id, backup, true)).rejects.toThrow(
      "模拟空间不足",
    );
    spy.mockRestore();
    expect(await listLocalPdfHighlights(target.id)).toHaveLength(0);
    expect(await listLocalPdfBookmarks(target.id)).toHaveLength(0);
    expect((await getLocalPdf(target.id))?.entry.page).toBe(1);
  });

  it.each(["range", "prototype", "duplicate", "version", "css", "progress"])(
    "拒绝损坏备份：%s",
    async (kind) => {
      const source = await seedPdf();
      const data = JSON.parse(await exportReadingBackup("pdf", source.id));
      if (kind === "range") data.highlights[0].end = -1;
      if (kind === "prototype")
        data.highlights[0].anchor = JSON.parse(
          '{"__proto__":{"polluted":true}}',
        );
      if (kind === "duplicate") data.bookmarks.push(data.bookmarks[0]);
      if (kind === "version") data.version = 2;
      if (kind === "css")
        data.highlights[0].color = "red; background: url(https://evil)";
      if (kind === "progress") data.progress.page = 999;
      expect(() => parseReadingBackup(JSON.stringify(data))).toThrow();
    },
  );

  it("拒绝超大文件和不具备安全加密环境的指纹计算", async () => {
    expect(() =>
      parseReadingBackup(" ".repeat(MAX_READING_BACKUP_BYTES + 1)),
    ).toThrow("20 MiB");
    vi.stubGlobal("crypto", undefined);
    await expect(fingerprintReadingFile(file())).rejects.toThrow("安全环境");
  });

  it("指纹覆盖多个分块，末尾变化也可检出", async () => {
    const prefix = new Uint8Array(4 * 1024 * 1024 + 1);
    const first = new Blob([prefix, "a"]);
    const second = new Blob([prefix, "b"]);
    expect(await fingerprintReadingFile(first)).not.toBe(
      await fingerprintReadingFile(second),
    );
    expect(await fingerprintReadingFile(first)).toBe(
      await fingerprintReadingFile(first),
    );
  });

  it("EPUB 文字锚点、备注、章节进度、主题和人工断行合并可恢复并去重", async () => {
    await listLocalEpubs();
    const blob = new Blob(["fixture epub bytes"]);
    const initial: LocalEpubEntry = {
      id: "source",
      name: "book.epub",
      title: "测试书",
      size: blob.size,
      mimeType: "application/epub+zip",
      importedAt: "2026-09-06T00:00:00Z",
      lastOpenedAt: "2026-09-06T00:00:00Z",
      chapter: 0,
      chapterCount: 2,
      fontSize: 100,
      theme: "light",
    };
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("nine_rings_epub_library");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("books", "readwrite");
        tx.objectStore("books").put({ ...initial, blob });
        tx.objectStore("books").put({ ...initial, id: "target", blob });
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
    });
    await updateLocalEpubProgress("source", {
      contentWidth: 80,
      chapter: 1,
      location: "chapter2.xhtml#anchor",
      scrollProgress: 0.6,
      chapterProgress: { "chapter1.xhtml": 0.4, "chapter2.xhtml": 0.6 },
      fontSize: 120,
      theme: "sepia",
      themeBackgrounds: { sepia: "#ffeeaa" },
      smartLineMerge: true,
      manualLineMerges: [
        {
          id: "merge",
          chapterPath: "chapter2.xhtml",
          left: "hello",
          right: "world",
          createdAt: initial.importedAt,
        },
      ],
    });
    await addLocalEpubHighlight("source", {
      chapterPath: "chapter2.xhtml",
      start: 0,
      end: 5,
      exact: "hello",
      prefix: "",
      suffix: "world",
    });
    await addLocalEpubBookmark({
      epubId: "source",
      chapter: 1,
      chapterPath: "chapter2.xhtml",
      scrollProgress: 0.6,
      label: "阅读至此",
    });
    const backup = await previewReadingBackup(
      "epub",
      "target",
      await exportReadingBackup("epub", "source"),
    );
    expect(await restoreReadingBackup("target", backup, true)).toMatchObject({
      added: 2,
      lineMergesAdded: 1,
    });
    expect((await getLocalEpub("target"))?.entry).toMatchObject({
      contentWidth: 80,
      chapter: 1,
      scrollProgress: 0.6,
      fontSize: 120,
      theme: "sepia",
      chapterProgress: { "chapter1.xhtml": 0.4, "chapter2.xhtml": 0.6 },
      themeBackgrounds: { sepia: "#ffeeaa" },
    });
    expect((await listLocalEpubHighlights("target"))[0].anchor.exact).toBe(
      "hello",
    );
    expect(await restoreReadingBackup("target", backup)).toMatchObject({
      added: 0,
      skipped: 2,
      lineMergesAdded: 0,
    });
    expect((await getLocalEpub("target"))?.entry.manualLineMerges).toHaveLength(
      1,
    );
  });
});
