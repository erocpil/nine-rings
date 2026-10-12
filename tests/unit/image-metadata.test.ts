import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseImageMetadata } from "../../src/lib/image-library/image-metadata";
it("reports original PNG dimensions and encoded color details", () => {
  const bytes = readFileSync("public/icon-192.png");
  const result = parseImageMetadata(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  expect(result.format).toBe("PNG");
  expect(result.width).toBe(192);
  expect(result.height).toBe(192);
  expect(result.rows.some(([label]) => label === "每通道位深")).toBe(true);
});
it("reads JPEG camera metadata without following arbitrary TIFF offsets", () => {
  // Minimal JPEG APP1 with a TIFF IFD containing an ISO tag.
  const bytes = new Uint8Array(40);
  const view = new DataView(bytes.buffer);
  bytes.set([255, 216, 255, 225]);
  view.setUint16(4, 34);
  bytes.set(new TextEncoder().encode("Exif\0\0II"), 6);
  view.setUint16(14, 42, true);
  view.setUint32(16, 8, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 0x8827, true);
  view.setUint16(24, 3, true);
  view.setUint32(26, 1, true);
  view.setUint16(30, 400, true);
  expect(parseImageMetadata(bytes.buffer).rows).toContainEqual(["ISO", "400"]);
  view.setUint32(16, 0xffffffff, true);
  expect(parseImageMetadata(bytes.buffer).rows).toEqual([]);
});
it("malformed/truncated headers never prevent viewing or allocate unbounded metadata", () => {
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array([255, 216, 255, 225, 255, 255]),
    new Uint8Array([137, 80, 78, 71]),
  ])
    expect(() => parseImageMetadata(bytes.buffer)).not.toThrow();
  const bytes = new Uint8Array(26);
  bytes.set([137, 80, 78, 71]);
  new DataView(bytes.buffer).setUint32(8, 0xffffffff);
  expect(parseImageMetadata(bytes.buffer).rows.length).toBeLessThan(10);
});
