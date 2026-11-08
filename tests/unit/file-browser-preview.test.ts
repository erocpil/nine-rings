import { expect, it } from "vitest";
import {
  browserPreviewIndex,
  browserPreviewMatches,
  browserSelectionSummary,
} from "../../src/lib/local-files/browser-preview";
import type { FileNode } from "../../src/lib/local-files/service";

const nodes: FileNode[] = [
  { id: "folder", name: "folder", directory: true, size: 10000 },
  { id: "a", name: "a", directory: false, size: 0, modifiedMs: 0 },
  { id: "b", name: "b", directory: false, size: 10, modifiedMs: 1 },
  { id: "unknown", name: "unknown", directory: false, size: 0 },
];
it("matches literal text with real UTF-16 offsets, case control, regex punctuation and bounded results", () => {
  expect(browserPreviewMatches("Ab ab AB", "ab").matches).toEqual([
    { from: 0, to: 2 },
    { from: 3, to: 5 },
    { from: 6, to: 8 },
  ]);
  expect(browserPreviewMatches("Ab ab AB", "ab", true).matches).toEqual([
    { from: 3, to: 5 },
  ]);
  expect(browserPreviewMatches("a.*[x]\\b a.[x]", ".*[x]\\").matches).toEqual([
    { from: 1, to: 7 },
  ]);
  expect(browserPreviewMatches("İ 😀a 😀a", "😀A").matches).toEqual([
    { from: 2, to: 5 },
    { from: 6, to: 9 },
  ]);
  expect(browserPreviewMatches("text", "").matches).toEqual([]);
  expect(browserPreviewMatches("text", "missing").matches).toEqual([]);
  expect(browserPreviewMatches("x".repeat(1000), "x").limited).toBe(false);
  const result = browserPreviewMatches("x".repeat(1001), "x");
  expect(result.matches).toHaveLength(1000);
  expect(result.limited).toBe(true);
});
it("steps only through loaded files, skips directories and never wraps at boundaries", () => {
  expect(browserPreviewIndex(nodes, undefined, 1)).toBe(1);
  expect(browserPreviewIndex(nodes, "a", 1)).toBe(2);
  expect(browserPreviewIndex(nodes, "b", -1)).toBe(1);
  expect(browserPreviewIndex(nodes, "a", -1)).toBeNull();
  expect(browserPreviewIndex(nodes, "unknown", 1)).toBeNull();
  expect(browserPreviewIndex(nodes, "removed", -1)).toBe(3);
  expect(browserPreviewIndex([], undefined, 1)).toBeNull();
});
it("totals known selected files, distinguishes empty files, directories and stale or missing metadata without scanning", () => {
  expect(
    browserSelectionSummary(
      nodes,
      ["a", "a", "b", "folder", "unknown", "unloaded"],
      {},
    ),
  ).toEqual({ bytes: 10, files: 2, directories: 1, unknown: 2 });
  expect(
    browserSelectionSummary(nodes, ["unknown"], {
      unknown: { size: 42, modifiedMs: 1 },
    }),
  ).toEqual({ bytes: 42, files: 1, directories: 0, unknown: 0 });
  for (const size of [NaN, -1, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(
      browserSelectionSummary(nodes, ["b"], { b: { size, modifiedMs: 1 } })
        .unknown,
    ).toBe(1);
  expect(
    browserSelectionSummary(nodes, ["a", "b"], {
      a: { size: Number.MAX_SAFE_INTEGER, modifiedMs: 1 },
    }),
  ).toMatchObject({ bytes: Number.MAX_SAFE_INTEGER, files: 1, unknown: 1 });
  expect(browserSelectionSummary(nodes, [], {})).toEqual({
    bytes: 0,
    files: 0,
    directories: 0,
    unknown: 0,
  });
});
