import { expect, it } from "vitest";
import {
  foldedNumberRanges,
  relativeFoldedLineNumber,
  relativeNumber,
} from "../../src/lib/relative-numbering";

it("folded blocks count visible steps while retaining absolute menu identities", () => {
  const visible = [1, 4, 5, 8, 12];
  expect(visible.map((number) => relativeNumber(number, 8, visible))).toEqual([
    3, 2, 1, 8, 1,
  ]);
  // A cursor inside hidden content belongs to its enclosing visible fold.
  expect(visible.map((number) => relativeNumber(number, 3, visible))).toEqual([
    1, 1, 2, 3, 4,
  ]);
});

it("nested and adjacent source folds subtract hidden logical lines only once", () => {
  const ranges = foldedNumberRanges([
    [2, 6],
    [3, 4],
    [7, 9],
    [15, 18],
    [19, 18],
  ]);
  expect(ranges).toEqual([
    { from: 2, to: 9, before: 0 },
    { from: 15, to: 18, before: 8 },
  ]);
  expect(
    [1, 10, 11, 12, 13, 14, 19, 20].map((number) =>
      relativeFoldedLineNumber(number, 12, ranges),
    ),
  ).toEqual([3, 2, 1, 12, 1, 2, 3, 4]);
  expect(relativeFoldedLineNumber(1, 5, ranges)).toBe(1);
  expect(relativeFoldedLineNumber(100000, 1, ranges)).toBe(99987);
});
