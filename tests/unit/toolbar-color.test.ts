import { expect, it } from "vitest";
import { caretWordRange } from "../../src/lib/toolbar-color";
it("targets words without crossing whitespace, punctuation or embedded nodes", () => {
  expect(caretWordRange("first second", 3)).toEqual({ from: 0, to: 5 });
  expect(caretWordRange("first second", 5)).toBeNull();
  expect(caretWordRange("first second", 6)).toEqual({ from: 6, to: 12 });
  expect(caretWordRange("first second", 12)).toEqual({ from: 6, to: 12 });
  expect(caretWordRange("first,second", 5)).toBeNull();
  expect(caretWordRange("first\ufffcsecond", 5)).toBeNull();
  expect(caretWordRange("", 0)).toBeNull();
  const range = caretWordRange("文字颜色", 1)!;
  expect(range.from).toBeLessThanOrEqual(1);
  expect(range.to).toBeGreaterThan(1);
});
