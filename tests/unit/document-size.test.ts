import { describe, expect, it } from "vitest";
import { documentSizeBytes, formatDocumentSize } from "../../src/lib/document-size";

describe("document body size", () => {
  it("counts serialized Unicode content as UTF-8 bytes", () => {
    const content = { ops: [{ insert: "中文🌱" }, { insert: "\n" }] };
    expect(documentSizeBytes(content)).toBe(new TextEncoder().encode(JSON.stringify(content)).byteLength);
    expect(documentSizeBytes(content)).toBeGreaterThan(JSON.stringify(content).length);
  });

  it("formats byte, kilobyte and megabyte sizes", () => {
    expect(formatDocumentSize(0)).toBe("0 B");
    expect(formatDocumentSize(1023)).toBe("1023 B");
    expect(formatDocumentSize(1536)).toBe("1.5 KB");
    expect(formatDocumentSize(1024 * 1024)).toBe("1.0 MB");
  });
});
