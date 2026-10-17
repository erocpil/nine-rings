import { describe, expect, it } from "vitest";
import {
  mixQuoteColor,
  quoteAlertPalette,
  quoteContrast,
} from "../../src/lib/quote-alert-colors";

describe("提示引用配色", () => {
  for (const backgrounds of [
    ["#ffffff", "#f6f3e8"],
    ["#141a20", "#202833"],
    ["#dde8d8", "#eef3e8"],
  ]) {
    it(`在 ${backgrounds[0]} 上保持类型区分与文字对比度`, () => {
      const palette = quoteAlertPalette(backgrounds, "#567890")!;
      expect(palette).not.toBeNull();
      expect(new Set(Object.values(palette)).size).toBe(5);
      for (const ink of Object.values(palette)) {
        for (const background of backgrounds) {
          expect(
            quoteContrast(ink, mixQuoteColor(background, ink, 0.035)),
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
  it("无法同时适配背景或无法解析颜色时安全回退", () => {
    expect(quoteAlertPalette(["#000000", "#ffffff"], "#888888")).toBeNull();
    expect(quoteAlertPalette(["unknown"], "#ffffff")).toBeNull();
    expect(quoteAlertPalette([], "#ffffff")).toBeNull();
  });
});
