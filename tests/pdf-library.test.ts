import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import {
  deleteLocalPdf,
  getLocalPdf,
  importLocalPdf,
  listLocalPdfs,
  resetPdfLibraryConnectionForTests,
  updateLocalPdfProgress,
} from "../src/lib/pdf-library";

function pdfFile(name: string, body = "sample"): File {
  const blob = new Blob([`%PDF-1.7\n${body}\n%%EOF`], { type: "application/pdf" });
  Object.defineProperty(blob, "name", { value: name });
  return blob as File;
}

async function run() {
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

  await assert.rejects(() => importLocalPdf(new Blob(["not pdf"], { type: "text/plain" }) as File), /不是有效的 PDF/);

  await deleteLocalPdf(imported.id);
  assert.equal(await getLocalPdf(imported.id), null);
  assert.deepEqual(await listLocalPdfs(), []);

  await resetPdfLibraryConnectionForTests();
  console.log("PDF library passed");
}

void run();
