import { expect, it } from "vitest";
import { selectDocumentToc } from "../../src/lib/document-outline";
it("TOC uses actual visible levels, preserves H1 resets and skipped heading levels", () => {
  const items = [1, 2, 3, 1, 2, 3, 4, 5, 6, 3, 1, 2, 3].map((level, pos) => ({
    pos,
    level,
    text: `heading ${pos}`,
  }));
  const entries = selectDocumentToc(items, [2, 3]);
  expect(entries.map((e) => [e.pos, e.level, e.depth])).toEqual([
    [1, 2, 0],
    [2, 3, 1],
    [4, 2, 0],
    [5, 3, 1],
    [9, 3, 1],
    [11, 2, 0],
    [12, 3, 1],
  ]);
  expect(
    selectDocumentToc(
      items.filter((e) => e.level >= 2),
      [1, 2, 3, 6],
    ).map((e) => e.depth),
  ).toEqual([0, 1, 0, 1, 4, 1, 0, 1]);
  expect(selectDocumentToc(items, [])).toEqual([]);
});
