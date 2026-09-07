import { expect, it } from "vitest";
import { PdfPageCache, type CachedPdfPage } from "../../src/lib/pdf-page-cache";

function entry(signature = "full", pixels = 4): CachedPdfPage {
  return {
    canvas: { width: pixels, height: 1 } as HTMLCanvasElement,
    signature,
    width: "10px",
    height: "20px",
  };
}
it("retains recent pages and releases least recently used buffers", () => {
  const cache = new PdfPageCache(2, 100);
  const first = entry(),
    second = entry(),
    third = entry();
  cache.put(1, first);
  cache.put(2, second);
  expect(cache.peek(1)).toBe(first);
  cache.put(3, third);
  expect(second.canvas.width).toBe(0);
  expect(cache.take(1, "full")).toBe(first);
  expect(first.canvas.width).toBe(4);
  cache.clear();
  expect(third.canvas.width).toBe(0);
  expect(first.canvas.width).toBe(4); // Caller owns a taken bitmap.
});
it("enforces pixel limits and rejects changed scale/document signatures", () => {
  const cache = new PdfPageCache(10, 6);
  const first = entry(),
    second = entry();
  cache.put(1, first);
  cache.put(2, second);
  expect(cache.pixels).toBe(4);
  expect(first.canvas.width).toBe(0);
  expect(cache.take(2, "new-scale")).toBeUndefined();
  expect(second.canvas.width).toBe(0);
  const oversized = entry("large", 7);
  cache.put(3, oversized);
  expect(cache.pixels).toBe(0);
  expect(oversized.canvas.width).toBe(0);
});
