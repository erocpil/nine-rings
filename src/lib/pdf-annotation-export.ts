import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from "pdf-lib";
import type { LocalPdfHighlight } from "./pdf-library";

export interface PdfTextGeometryItem {
  str: string;
  width: number;
  height: number;
  transform: number[];
}

export interface PdfHighlightGeometry {
  highlight: LocalPdfHighlight;
  quadPoints: number[][];
}

export function highlightQuadPoints(
  items: readonly PdfTextGeometryItem[],
  starts: readonly number[],
  highlight: Pick<LocalPdfHighlight, "start" | "end">,
): number[][] {
  const quads: number[][] = [];
  items.forEach((item, index) => {
    if (!item.str || item.transform.length < 6 || item.width <= 0) return;
    const itemStart = starts[index] ?? 0;
    const itemEnd = itemStart + item.str.length;
    const overlapStart = Math.max(highlight.start, itemStart);
    const overlapEnd = Math.min(highlight.end, itemEnd);
    if (overlapStart >= overlapEnd) return;

    const [a, b, , , originX, originY] = item.transform;
    const axisLength = Math.hypot(a, b) || 1;
    const axisX = a / axisLength;
    const axisY = b / axisLength;
    const normalX = -axisY;
    const normalY = axisX;
    const height = Math.max(1, item.height || axisLength);
    const startRatio = (overlapStart - itemStart) / item.str.length;
    const endRatio = (overlapEnd - itemStart) / item.str.length;
    const startX = originX + axisX * item.width * startRatio;
    const startY = originY + axisY * item.width * startRatio;
    const endX = originX + axisX * item.width * endRatio;
    const endY = originY + axisY * item.width * endRatio;
    const topOffset = height * 0.82;
    const bottomOffset = -height * 0.18;
    quads.push([
      startX + normalX * topOffset,
      startY + normalY * topOffset,
      endX + normalX * topOffset,
      endY + normalY * topOffset,
      startX + normalX * bottomOffset,
      startY + normalY * bottomOffset,
      endX + normalX * bottomOffset,
      endY + normalY * bottomOffset,
    ]);
  });
  return quads;
}

function annotationRect(quads: readonly number[][]): number[] {
  const xs: number[] = [];
  const ys: number[] = [];
  quads.forEach((quad) => {
    for (let index = 0; index < quad.length; index += 2) {
      xs.push(quad[index]);
      ys.push(quad[index + 1]);
    }
  });
  return [Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1];
}

export async function exportPdfWithHighlights(
  source: ArrayBuffer,
  geometries: readonly PdfHighlightGeometry[],
): Promise<Uint8Array> {
  const document = await PDFDocument.load(source, { updateMetadata: false });
  const pages = document.getPages();
  for (const { highlight, quadPoints } of geometries) {
    if (quadPoints.length === 0) continue;
    const page = pages[highlight.page - 1];
    if (!page) continue;
    const annotation = document.context.obj({
      Type: "Annot",
      Subtype: "Highlight",
      Rect: annotationRect(quadPoints),
      QuadPoints: quadPoints.flat(),
      C: [1, 0.82, 0],
      CA: 0.38,
      F: 4,
      T: PDFHexString.fromText("Nine Rings"),
      Contents: PDFHexString.fromText(highlight.text),
      M: PDFString.fromDate(new Date(highlight.createdAt || Date.now())),
      NM: PDFHexString.fromText(highlight.id),
    });
    const annotationRef = document.context.register(annotation);
    let annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annotations) {
      annotations = document.context.obj([]);
      page.node.set(PDFName.of("Annots"), annotations);
    }
    annotations.push(annotationRef);
  }
  return document.save({ useObjectStreams: true });
}
