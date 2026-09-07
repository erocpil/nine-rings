import { describe, expect, it } from "vitest";
import {
  lockedPdfScale,
  normalizeEpubWidth,
  normalizePdfWidth,
} from "../../src/lib/reader-width";

describe("阅读宽度", () => {
  it("旧数据和非法数据回退默认，限制有效范围", () => {
    for (const value of [undefined, null, NaN, Infinity, "80"]) {
      expect(normalizePdfWidth(value)).toBeNull();
      expect(normalizeEpubWidth(value)).toBe(100);
    }
    expect(normalizePdfWidth(-1)).toBeNull();
    expect(normalizePdfWidth(100)).toBe(10);
    expect(normalizeEpubWidth(10)).toBe(60);
    expect(normalizeEpubWidth(80)).toBe(80);
  });
  it("不同纸张尺寸保持同一宽度，旋转后保持可视区比例", () => {
    for (const viewport of [390, 760]) {
      for (const paper of [300, 600, 900]) {
        expect(lockedPdfScale(0.8, viewport, paper) * paper).toBeCloseTo(
          (viewport - 24) * 0.8,
        );
      }
    }
  });
});
