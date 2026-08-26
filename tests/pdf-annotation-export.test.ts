import assert from "node:assert/strict";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
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
  [
    { highlight, quadPoints },
    { highlight: { ...highlight, id: "underline-1", kind: "underline", color: "#00aaee" }, quadPoints },
    {
      highlight: {
        ...highlight,
        id: "text-1",
        kind: "freeText",
        text: "PDF note",
        rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.12 },
      },
      quadPoints: [],
    },
    {
      highlight: {
        ...highlight,
        id: "arrow-1",
        kind: "arrow",
        points: { x1: 0.2, y1: 0.3, x2: 0.7, y2: 0.6 },
      },
      quadPoints: [],
    },
  ],
);
const result = await PDFDocument.load(exported);
const annotations = result.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
assert.equal(annotations.size(), 4);
assert.deepEqual(
  Array.from({ length: annotations.size() }, (_, index) => (
    annotations.lookup(index, PDFDict).get(PDFName.of("Subtype"))?.toString()
  )),
  ["/Highlight", "/Underline", "/FreeText", "/Line"],
);
const arrow = annotations.lookup(3, PDFDict);
assert.equal(arrow.get(PDFName.of("LE"))?.toString(), "[ /None /OpenArrow ]");

console.log("PDF annotation export passed");
