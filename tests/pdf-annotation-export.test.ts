import assert from "node:assert/strict";
import { PDFArray, PDFDocument, PDFName } from "pdf-lib";
import { exportPdfWithHighlights, highlightQuadPoints } from "../src/lib/pdf-annotation-export";

const highlight = {
  id: "highlight-1",
  pdfId: "pdf-1",
  page: 1,
  start: 1,
  end: 4,
  text: "ell",
  color: "yellow" as const,
  createdAt: "2026-08-26T00:00:00.000Z",
};

const quadPoints = highlightQuadPoints([
  { str: "Hello", width: 50, height: 10, transform: [10, 0, 0, 10, 100, 200] },
], [0], highlight);
assert.deepEqual(quadPoints, [[110, 208.2, 140, 208.2, 110, 198.2, 140, 198.2]]);

const source = await PDFDocument.create();
source.addPage([300, 400]);
const sourceBytes = await source.save();
const exported = await exportPdfWithHighlights(
  sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength) as ArrayBuffer,
  [{ highlight, quadPoints }],
);
const result = await PDFDocument.load(exported);
const annotations = result.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
assert.equal(annotations.size(), 1);

console.log("PDF annotation export passed");
