import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import {
  addLocalPdfBookmark,
  addLocalPdfAnnotation,
  addLocalPdfHighlight,
  deleteLocalPdf,
  deleteLocalPdfBookmark,
  deleteLocalPdfHighlight,
  getLocalPdf,
  importLocalPdf,
  listLocalPdfBookmarks,
  listLocalPdfHighlights,
  listLocalPdfs,
  resetPdfLibraryConnectionForTests,
  updateLocalPdfProgress,
  updateLocalPdfHighlight,
} from "../src/lib/pdf-library";

function pdfFile(name: string, body = "sample"): File {
  const blob = new Blob([`%PDF-1.7\n${body}\n%%EOF`], { type: "application/pdf" });
  Object.defineProperty(blob, "name", { value: name });
  return blob as File;
}

async function createVersionOneDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("nine_rings_pdf_library", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("documents", { keyPath: "id" });
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

async function run() {
  // 已安装用户会从仅包含 documents store 的 v1 原位升级。
  await createVersionOneDatabase();
  const imported = await importLocalPdf(pdfFile("manual.pdf"));
  assert.equal(imported.name, "manual.pdf");
  assert.equal(imported.page, 1);
  assert.equal(imported.fitWidth, true);

  const listed = await listLocalPdfs();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, imported.id);

  const stored = await getLocalPdf(imported.id);
  assert.ok(stored);
  assert.match(await stored.blob.text(), /^%PDF-/);

  await updateLocalPdfProgress(imported.id, {
    page: 7,
    zoom: 1.4,
    fitWidth: false,
    pageCount: 18,
  });
  const progressed = await getLocalPdf(imported.id);
  assert.equal(progressed?.entry.page, 7);
  assert.equal(progressed?.entry.zoom, 1.4);
  assert.equal(progressed?.entry.fitWidth, false);
  assert.equal(progressed?.entry.pageCount, 18);

  const highlight = await addLocalPdfHighlight({
    pdfId: imported.id,
    page: 7,
    start: 4,
    end: 15,
    text: "stable text",
  });
  assert.deepEqual((await listLocalPdfHighlights(imported.id)).map((item) => item.id), [highlight.id]);
  await assert.rejects(() => addLocalPdfHighlight({
    pdfId: imported.id,
    page: 7,
    start: 4,
    end: 4,
    text: "invalid",
  }), /范围无效/);
  await deleteLocalPdfHighlight(highlight.id);
  assert.deepEqual(await listLocalPdfHighlights(imported.id), []);

  const textBox = await addLocalPdfAnnotation({
    pdfId: imported.id,
    page: 3,
    kind: "freeText",
    start: 0,
    end: 0,
    text: "review this",
    color: "#ff0000",
    rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
    fontSize: 16,
  });
  const updatedTextBox = await updateLocalPdfHighlight(textBox.id, { note: "important", fontSize: 18 });
  assert.equal(updatedTextBox.note, "important");
  assert.equal(updatedTextBox.fontSize, 18);
  await deleteLocalPdfHighlight(textBox.id);

  const bookmark = await addLocalPdfBookmark(imported.id, 7, "重要章节");
  assert.equal((await listLocalPdfBookmarks(imported.id))[0]?.label, "重要章节");
  await deleteLocalPdfBookmark(bookmark.id);
  assert.deepEqual(await listLocalPdfBookmarks(imported.id), []);

  await addLocalPdfHighlight({ pdfId: imported.id, page: 2, start: 0, end: 4, text: "keep" });
  await addLocalPdfBookmark(imported.id, 2, "第二页");

  await assert.rejects(() => importLocalPdf(new Blob(["not pdf"], { type: "text/plain" }) as File), /不是有效的 PDF/);

  await deleteLocalPdf(imported.id);
  assert.equal(await getLocalPdf(imported.id), null);
  assert.deepEqual(await listLocalPdfHighlights(imported.id), []);
  assert.deepEqual(await listLocalPdfBookmarks(imported.id), []);
  assert.deepEqual(await listLocalPdfs(), []);

  await resetPdfLibraryConnectionForTests();
  console.log("PDF library passed");
}

void run();
