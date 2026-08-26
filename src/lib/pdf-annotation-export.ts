import {
  PDFArray,
  PDFDict,
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

function rgbComponents(color: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "ffd600";
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255) as [number, number, number];
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
    const page = pages[highlight.page - 1];
    if (!page) continue;
    const kind = highlight.kind ?? "highlight";
    const color = rgbComponents(highlight.color);
    const common = {
      Type: "Annot",
      C: color,
      CA: 0.38,
      F: 4,
      T: PDFHexString.fromText("Nine Rings"),
      Contents: PDFHexString.fromText(highlight.note || highlight.text),
      M: PDFString.fromDate(new Date(highlight.createdAt || Date.now())),
      NM: PDFHexString.fromText(highlight.id),
    };
    let annotation: PDFDict;
    if (kind === "highlight" || kind === "underline" || kind === "strikeout") {
      if (quadPoints.length === 0) continue;
      annotation = document.context.obj({
        ...common,
        Subtype: kind === "highlight" ? "Highlight" : kind === "underline" ? "Underline" : "StrikeOut",
        Rect: annotationRect(quadPoints),
        QuadPoints: quadPoints.flat(),
      });
    } else if (kind === "freeText" || kind === "square" || kind === "circle") {
      if (!highlight.rect) continue;
      const { width: pageWidth, height: pageHeight } = page.getSize();
      const rect = [
        highlight.rect.x * pageWidth,
        (1 - highlight.rect.y - highlight.rect.height) * pageHeight,
        (highlight.rect.x + highlight.rect.width) * pageWidth,
        (1 - highlight.rect.y) * pageHeight,
      ];
      annotation = document.context.obj({
        ...common,
        Subtype: kind === "freeText" ? "FreeText" : kind === "square" ? "Square" : "Circle",
        Rect: rect,
        Contents: PDFHexString.fromText(highlight.text || highlight.note || ""),
        BS: { W: 2, S: "S" },
        ...(kind === "freeText" ? {
          DA: PDFString.of(`/Helv ${highlight.fontSize ?? 14} Tf ${color.join(" ")} rg`),
          Q: 0,
        } : {}),
      });
    } else {
      if (!highlight.points) continue;
      const { width: pageWidth, height: pageHeight } = page.getSize();
      annotation = document.context.obj({
        ...common,
        Subtype: "Line",
        Rect: [
          Math.min(highlight.points.x1, highlight.points.x2) * pageWidth - 2,
          (1 - Math.max(highlight.points.y1, highlight.points.y2)) * pageHeight - 2,
          Math.max(highlight.points.x1, highlight.points.x2) * pageWidth + 2,
          (1 - Math.min(highlight.points.y1, highlight.points.y2)) * pageHeight + 2,
        ],
        L: [
          highlight.points.x1 * pageWidth,
          (1 - highlight.points.y1) * pageHeight,
          highlight.points.x2 * pageWidth,
          (1 - highlight.points.y2) * pageHeight,
        ],
        LE: kind === "arrow" ? ["None", "OpenArrow"] : ["None", "None"],
        BS: { W: 2, S: "S" },
      });
    }
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
